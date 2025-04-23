import { ipcMain } from 'electron';
import { getWebSocket, getIsStreaming, sendToWebSocket } from './websocket-client';
import { getMainWindow } from './window-manager';
import { captureScreenshot } from './screenshot';
import { createNewChatSession, getPendingToolCall, removePendingToolCall } from './chat-session';
import { executeTool } from '../tools/tool-executor';

/**
 * Registers all IPC event handlers
 */
export function registerIpcHandlers(): void {
  registerSendMessageHandler();
  registerSendApiKeysHandler();
  registerToolResponseHandler();
  registerUserResponseHandler();
  registerSetLlmModelHandler();
  registerSendAudioInputHandler();
  registerStartNewChatHandler();
  registerStopProcessingHandler();
}

/**
 * Registers the handler for sending messages
 */
function registerSendMessageHandler(): void {
  ipcMain.on('send-message', async (event, { text, includeScreenshot, contextText }: { 
    text: string, 
    includeScreenshot: boolean, 
    contextText: string | null 
  }) => {
    console.log(`[IPC] Received send-message: '${text}', Include Screenshot: ${includeScreenshot}, Context Provided: ${!!contextText}`);
    
    const mainWindow = getMainWindow();
    
    // Send user message back to UI immediately (without context, UI handles display)
    if (mainWindow) {
      mainWindow.webContents.send('message-from-main', { text: text, isUser: true });
    } else {
      console.error("[IPC] mainWindow is null, cannot send user message back to UI.");
      return;
    }

    let screenshotDataUrl: string | null = null;
    
    // Capture screenshot if requested
    if (includeScreenshot) {
      screenshotDataUrl = await captureScreenshot();
      
      // Send screenshot back to UI
      if (mainWindow && screenshotDataUrl) {
        mainWindow.webContents.send('message-from-main', { 
          text: screenshotDataUrl, 
          isUser: false, 
          isImage: true 
        });
      } 
    }

    // Send message data to backend
    if (getIsStreaming()) {
      console.warn("[IPC] Attempted to send new message while previous response is still streaming. Ignoring.");
      return; 
    }

    console.log("[IPC] Sending user_message to backend...");
    
    sendToWebSocket({ 
      type: 'user_message', 
      text: text, 
      screenshot_data_url: screenshotDataUrl,
      context_text: contextText
    });
  });
}

/**
 * Registers the handler for sending API keys
 */
function registerSendApiKeysHandler(): void {
  ipcMain.on('send-api-keys', (event, keys: { [provider: string]: string }) => {
    console.log(`[IPC] Received send-api-keys request:`, Object.keys(keys));
    
    const success = sendToWebSocket({ 
      type: 'set_api_keys', 
      keys: keys
    });
    
    if (success) {
      console.log("[IPC] Sent set_api_keys to backend.");
    } else {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('toast-notification', { 
          text: 'Cannot send API keys, connection lost.'
        });
      }
    }
  });
}

/**
 * Registers the handler for tool responses
 */
function registerToolResponseHandler(): void {
  ipcMain.on('tool-response', (event, { 
    toolCallId, 
    decision, 
    result 
  }: { 
    toolCallId: string, 
    decision: 'approved' | 'denied', 
    result?: string 
  }) => {
    console.log(`[IPC] Received tool-response for ${toolCallId}. Decision: ${decision}`);
    
    const pendingCall = getPendingToolCall(toolCallId);
    if (!pendingCall) {
      console.error(`[IPC] Received response for unknown toolCallId: ${toolCallId}`);
      return;
    }
    
    // Remove the call from pending once received
    removePendingToolCall(toolCallId);

    // Use the external executor function
    executeTool(getWebSocket(), getMainWindow(), pendingCall, decision);
  });
}

/**
 * Registers the handler for user responses to agent questions
 */
function registerUserResponseHandler(): void {
  ipcMain.on('user-response', (event, { 
    request_id, 
    answer 
  }: { 
    request_id: string, 
    answer: string 
  }) => {
    console.log(`[IPC] Received user-response for request_id: ${request_id}`);
    
    const success = sendToWebSocket({
      type: 'user_response',
      request_id: request_id,
      answer: answer
    });
    
    if (!success) {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('toast-notification', { 
          text: 'Cannot send response, connection lost.'
        });
      }
    }
  });
}

/**
 * Registers the handler for setting the LLM model
 */
function registerSetLlmModelHandler(): void {
  ipcMain.on('set-llm-model', (event, modelName: string) => {
    console.log(`[IPC] Received set-llm-model request: ${modelName}`);
    
    sendToWebSocket({ 
      type: 'set_llm_model', 
      model_name: modelName
    });
  });
}

/**
 * Registers the handler for sending audio input
 */
function registerSendAudioInputHandler(): void {
  ipcMain.on('send-audio-input', (event, { 
    audioData, 
    format 
  }: { 
    audioData: string, 
    format: string 
  }) => {
    console.log(`[IPC] Received send-audio-input (format: ${format})`);
    
    const success = sendToWebSocket({
      type: 'audio_input',
      audio_data: audioData,
      format: format
    });
    
    if (success) {
      console.log('[IPC] Sent audio_input to backend.');
    } else {
      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('toast-notification', { 
          text: 'Cannot send audio, connection lost.'
        });
      }
    }
  });
}

/**
 * Registers the handler for starting a new chat
 */
function registerStartNewChatHandler(): void {
  ipcMain.on('start-new-chat', (event) => {
    console.log('[IPC] Received start-new-chat request');
    createNewChatSession();
  });
} 

/**
 * Registers the handler for stopping processing
 */
function registerStopProcessingHandler(): void {
  ipcMain.on('stop-processing', () => {
    console.log('[IPC] Received stop-processing request');
    sendToWebSocket({ type: 'stop' });
  });
}