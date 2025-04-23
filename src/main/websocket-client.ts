import WebSocket from 'ws';
import { getMainWindow } from './window-manager';
import { getCurrentChatId, clearPendingToolCalls, addPendingToolCall, registerWebSocketFunctions } from './chat-session';
import { executeTool } from '../tools/tool-executor';
import type { ToolCall, CostUpdatePayload } from '../types';

// Backend WebSocket connection settings
const BACKEND_BASE_URL = 'ws://127.0.0.1:8000/ws';

// WebSocket instance and streaming flag
let ws: WebSocket | null = null;
let isStreaming = false;
let isIntentionalClose = false;

// Register our functions with chat-session to avoid circular dependency
registerWebSocketFunctions(connectWebSocket, closeWebSocket);

/**
 * Gets whether a message is currently streaming
 */
export function getIsStreaming(): boolean {
  return isStreaming;
}

/**
 * Sets the streaming state
 */
export function setIsStreaming(streaming: boolean): void {
  isStreaming = streaming;
}

/**
 * Closes the current WebSocket connection if open
 */
export function closeWebSocket(): void {
  if (ws) {
    isIntentionalClose = true;
    ws.close();
    ws = null;
  }
}

/**
 * Gets the current WebSocket instance
 */
export function getWebSocket(): WebSocket | null {
  return ws;
}

/**
 * Connects to the WebSocket server
 */
export function connectWebSocket(): void {
  // Construct URL with Chat ID
  const chatId = getCurrentChatId();
  const backendUrlWithChatId = `${BACKEND_BASE_URL}?chat_id=${chatId}`;
  
  console.log('[WebSocket] Attempting to connect:', backendUrlWithChatId);
  
  ws = new WebSocket(backendUrlWithChatId);
  
  ws.on('open', () => {
    console.log('[WebSocket] Connection established with backend.');
    isStreaming = false; // Reset flag on new connection
    clearPendingToolCalls(); // Clear pending calls on new connection
    
    // Add toast notification for connection established
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('toast-notification', { 
        text: 'Connected to backend'
      });
    }
  });

  ws.on('message', (data) => {
    console.log('[WebSocket] Received message from backend:', data.toString().substring(0, 200) + '...'); 
    
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      console.error("[WebSocket] Error: mainWindow is null.");
      return;
    }
    
    try {
      const messageData = JSON.parse(data.toString());
      const messageType = messageData.type;

      switch (messageType) {
        case 'chunk':
          if (!isStreaming) {
            // Start of a new stream
            isStreaming = true;
            console.log('[WebSocket] Sending stream-start');
            mainWindow.webContents.send('stream-start', { isUser: false });
          }
          // Send the chunk content
          mainWindow.webContents.send('stream-chunk', { delta: messageData.content });
          break;

        case 'end':
          if (isStreaming) {
            // End of the current stream
            isStreaming = false;
            console.log('[WebSocket] Sending stream-end');
            mainWindow.webContents.send('stream-end');
          }
          break;

        case 'error':
        case 'warning': // Treat warnings like errors for UI display
          // Handle errors/warnings sent explicitly from backend
          isStreaming = false; // Stop streaming if an error occurs
          console.error(`[WebSocket] Received backend ${messageType}:`, messageData.content);
          // Use toast notification for errors and warnings
          mainWindow.webContents.send('toast-notification', { 
            text: messageData.content
          });
          break;
            
        case 'tool_call_request': // Specifically for run_bash_command now
          isStreaming = false; // Stop any active text streaming
          console.log('[WebSocket] Received tool_call_request:', messageData.tool_calls);
          
          const receivedToolCalls: ToolCall[] = messageData.tool_calls;
          if (receivedToolCalls && Array.isArray(receivedToolCalls)) {
            receivedToolCalls.forEach((call: ToolCall) => {
              if (call.id && call.type === 'function' && call.function?.name) { // Basic validation
                // Auto-execute paste_at_cursor
                if (call.function.name === 'paste_at_cursor') {
                  console.log(`[WebSocket] Auto-executing paste_at_cursor: ${call.id}`);
                  // Directly execute without asking user
                  executeTool(ws, mainWindow, call, 'approved'); 
                } else {
                  // Store other client-side tools for approval
                  addPendingToolCall(call);
                  console.log(`[WebSocket] Stored pending tool call for approval: ${call.id} (${call.function.name})`);
                  // Forward the request to the renderer process for approval
                  console.log('[WebSocket] Sending tool-call-request-from-main for approval');
                  mainWindow?.webContents.send('tool-call-request-from-main', [call]); // Send only the one needing approval
                }
              } else {
                console.error('[WebSocket] Invalid tool call format in received list:', call);
              }
            });
          } else {
            console.error('[WebSocket] Invalid tool_call_request format received.');
            mainWindow.webContents.send('message-from-main', { 
              text: '[Internal Error: Invalid tool request format]', 
              isUser: false 
            });
          }
          break;    

        // Handle ask_user and terminate
        case 'ask_user_request':
          isStreaming = false;
          const question = messageData.question;
          console.log('[WebSocket] Sending ask-user-request-from-main');
          mainWindow.webContents.send('ask-user-request-from-main', question);
          break;
        
        case 'terminate_request':
          isStreaming = false;
          const reason = messageData.reason;
          console.log('[WebSocket] Sending terminate-request-from-main');
          mainWindow.webContents.send('terminate-request-from-main', reason);
          break;

        // Handle Agent Updates
        case 'agent_question':
          isStreaming = false; // Stop any text stream
          const questionData = { 
            question: messageData.question, 
            request_id: messageData.request_id 
          };
          console.log(`[WebSocket] Sending agent-question-from-main: ${questionData.request_id}`);
          mainWindow.webContents.send('agent-question-from-main', questionData);
          break;

        case 'agent_step_update':
          // Don't change isStreaming for step updates, they happen during agent processing
          const updateData = messageData.data; // Should contain thoughts, action, url
          console.log('[WebSocket] Sending agent-step-update-from-main');
          mainWindow.webContents.send('agent-step-update-from-main', updateData);
          break;

        // Handle Cost Update
        case 'cost_update':
          const costPayload: CostUpdatePayload = { 
            total_cost: messageData.total_cost 
          };
          console.log(`[WebSocket] Sending cost-update-from-main: $${costPayload.total_cost.toFixed(6)}`);
          mainWindow.webContents.send('cost-update-from-main', costPayload);
          break;

        // Handle Transcription Result from Backend
        case 'transcription_result':
          const transcribedText = messageData.text;
          console.log(`[WebSocket] Sending transcription-result-from-main: ${transcribedText.substring(0, 50)}...`);
          mainWindow.webContents.send('transcription-result-from-main', transcribedText);
          break;

        default:
          // Handle potential older format or unexpected messages gracefully
          // If we received something unexpected, assume any active stream ends
          if (isStreaming) {
            console.warn('[WebSocket] Stream ended due to unexpected message format.');
            isStreaming = false;
            mainWindow.webContents.send('stream-end'); 
          }
          console.warn('[WebSocket] Received unexpected message format:', messageData);
          // Check if it has a 'response' field for backward compatibility or other cases
          if (messageData.response) {
            mainWindow.webContents.send('message-from-main', { 
              text: messageData.response, 
              isUser: false 
            });
          } 
      }
    } catch (error) {
      isStreaming = false; // Stop streaming on parsing error
      console.error('[WebSocket] Error parsing message or sending to renderer:', error);
      mainWindow.webContents.send('toast-notification', { 
        text: 'Error parsing backend response'
      });
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Connection closed.');
    
    if (isIntentionalClose) {
      console.log('[WebSocket] Close was intentional, not reconnecting automatically.');
      isIntentionalClose = false;
      return;
    }

    console.log('[WebSocket] Connection lost unexpectedly. Attempting to reconnect...');
    ws = null;
    isStreaming = false;
    clearPendingToolCalls();
    
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('toast-notification', { 
        text: 'Connection lost. Reconnecting...'
      });
    }
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error.message);
    isStreaming = false;
    clearPendingToolCalls();
    
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('toast-notification', { 
        text: `WebSocket Error: ${error.message}`
      });
    }
    isIntentionalClose = false;
    if (ws) {
      isIntentionalClose = false; 
      ws.close();
    } else {
      setTimeout(connectWebSocket, 5000);
    }
  });
}

/**
 * Sends a message to the WebSocket server
 * @param message - The message to send
 * @returns true if message was sent, false otherwise
 */
export function sendToWebSocket(message: any): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WebSocket] Error sending data:', error);
      
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('toast-notification', { 
          text: 'Error sending data to backend'
        });
      }
      return false;
    }
  } else {
    console.error("[WebSocket] Not connected, cannot send message.");
    
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send('toast-notification', { 
        text: 'Cannot connect to backend'
      });
    }
    return false;
  }
} 