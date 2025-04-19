import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from 'electron';
import path from 'node:path';
import * as Path from 'node:path';
import WebSocket from 'ws';
// Import child_process for command execution (we'll use it later)
import { exec } from 'node:child_process';
import type { ToolCall } from './types'; // Import ToolCall type for storage

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let ws: WebSocket | null = null;
const backendUrl = 'ws://127.0.0.1:8000/ws';
let isStreaming = false; // Flag to track if we are currently streaming a response

// --- Store pending tool calls --- 
// Simple map to hold tool calls waiting for user response
// Key: toolCallId, Value: ToolCall object
const pendingToolCalls = new Map<string, ToolCall>();

function connectWebSocket() {
  console.log('Attempting to connect to WebSocket:', backendUrl);
  ws = new WebSocket(backendUrl);

  ws.on('open', () => {
    console.log('WebSocket connection established with backend.');
    isStreaming = false; // Reset flag on new connection
    pendingToolCalls.clear(); // Clear pending calls on new connection
  });

  ws.on('message', (data) => {
    console.log('[WebSocket] Received message from backend:', data.toString().substring(0, 200) + '...'); // Log more
    if (!mainWindow) {
        console.error("[WebSocket Handler] Error: mainWindow is null.");
        return;
    }
    try {
      const messageData = JSON.parse(data.toString());
      const messageType = messageData.type;
      // const messageContent = messageData.content; // Not always present

      // Reset streaming flag on non-chunk messages (except tool_call_request which is handled inside)
      if (messageType !== 'chunk') {
          // isStreaming = false; // Careful: causes issues if tool req happens mid-stream
      }

      switch (messageType) {
          case 'chunk':
              if (!isStreaming) {
                  // Start of a new stream
                  isStreaming = true;
                  console.log('[IPC] Sending stream-start');
                  mainWindow.webContents.send('stream-start', { isUser: false });
              }
              // Send the chunk content
              // console.log('[IPC] Sending stream-chunk'); // Can be too noisy
              mainWindow.webContents.send('stream-chunk', { delta: messageData.content });
              break;

          case 'end':
              if (isStreaming) {
                  // End of the current stream
                  isStreaming = false;
                  console.log('[IPC] Sending stream-end');
                  mainWindow.webContents.send('stream-end');
              }
              break;

          case 'error':
              // Handle errors sent explicitly from backend
              isStreaming = false; // Stop streaming if an error occurs
              console.error('[WebSocket] Received backend error:', messageData.content);
              mainWindow.webContents.send('message-from-main', { text: `[Backend Error: ${messageData.content}]`, isUser: false });
              break;
              
          case 'tool_call_request': // Specifically for run_bash_command now
              isStreaming = false; // Stop any active text streaming
              console.log('[WebSocket] Received tool_call_request:', messageData.tool_calls);
              const receivedToolCalls = messageData.tool_calls;
              if (receivedToolCalls && Array.isArray(receivedToolCalls)) {
                  // Store pending calls before forwarding
                  receivedToolCalls.forEach((call: ToolCall) => {
                      if (call.id && call.type === 'function') { // Basic validation
                          pendingToolCalls.set(call.id, call);
                          console.log(`[Main] Stored pending tool call: ${call.id}`);
                      }
                  });
                  // Forward the request to the renderer process
                  console.log('[IPC] Sending tool-call-request-from-main');
                  mainWindow.webContents.send('tool-call-request-from-main', receivedToolCalls);
              } else {
                  console.error('[WebSocket Handler] Invalid tool_call_request format received.');
                  mainWindow.webContents.send('message-from-main', { text: '[Internal Error: Invalid tool request format]', isUser: false });
              }
              break;    

          // --- Handle ask_user and terminate --- 
          case 'ask_user_request':
              isStreaming = false;
              const question = messageData.question;
              console.log('[IPC] Sending ask-user-request-from-main');
              mainWindow.webContents.send('ask-user-request-from-main', question);
              break;
          
          case 'terminate_request':
              isStreaming = false;
              const reason = messageData.reason;
              console.log('[IPC] Sending terminate-request-from-main');
              mainWindow.webContents.send('terminate-request-from-main', reason);
              // Optionally, you might want to close the websocket or disable input here
              break;
          // --- End ask_user / terminate handling ---

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
                 mainWindow.webContents.send('message-from-main', { text: messageData.response, isUser: false });
             } 
             // Add more specific handling here if other message types are expected
      }

    } catch (error) {
      isStreaming = false; // Stop streaming on parsing error
      console.error('[WebSocket Handler] Error parsing message or sending to renderer:', error);
      mainWindow.webContents.send('message-from-main', { text: '[Error parsing backend response]', isUser: false });
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed. Attempting to reconnect...');
    ws = null;
    isStreaming = false; // Reset flag
    pendingToolCalls.clear(); // Clear pending calls
    if (mainWindow) {
        // Optionally notify the renderer that the connection is lost
        mainWindow.webContents.send('message-from-main', { text: '[Connection lost. Reconnecting...]', isUser: false });
    }
    setTimeout(connectWebSocket, 5000); // Attempt to reconnect
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    isStreaming = false; // Reset flag
    pendingToolCalls.clear(); // Clear pending calls
    if (mainWindow) {
        // Notify the renderer about the error
        mainWindow.webContents.send('message-from-main', { text: `[WebSocket Error: ${error.message}]`, isUser: false });
    }
    // Note: 'close' event will likely fire after 'error', triggering reconnection logic
  });
}

// --- Send Tool Result back to Backend --- 
function sendToolResultToBackend(toolCallId: string, content: string) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const resultPayload = {
            type: 'tool_result',
            results: [
                { tool_call_id: toolCallId, content: content }
            ]
        };
        console.log('[WebSocket Send] Sending tool_result:', resultPayload);
        ws.send(JSON.stringify(resultPayload));
    } else {
        console.error('[WebSocket Send] Cannot send tool_result, WebSocket not connected.');
        // Optionally inform the user in the UI
        if (mainWindow) {
            mainWindow.webContents.send('message-from-main', { text: '[Error: Cannot send command result to backend]', isUser: false });
        }
    }
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    transparent: true,
    // icon: Path.join(__dirname, '../nohup.png'), // Removed for now
    webPreferences: {
      preload: Path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true, // Temporarily enable for child_process (use with caution, consider sandboxing)
      // nodeIntegration: false, // Preferred, but makes child_process harder directly in preload
    },
  });

  mainWindow.setBackgroundColor('#00000000');

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(Path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools(); // Keep DevTools closed for now

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (ws) {
      ws.close();
    }
    pendingToolCalls.clear(); // Clear on close
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  createWindow();
  connectWebSocket();

  ipcMain.on('send-message', async (event, { text, includeScreenshot }: { text: string, includeScreenshot: boolean }) => {
    console.log(`[IPC] Received send-message: '${text}', Include Screenshot: ${includeScreenshot}`);
    
    // 1. Send user message back to UI immediately
    if (mainWindow) {
      mainWindow.webContents.send('message-from-main', { text: text, isUser: true });
    } else {
      console.error("[IPC Handler] mainWindow is null, cannot send user message back to UI.");
      // Decide if we should proceed without UI feedback
      // return; 
    }

    let screenshotDataUrl: string | null = null;
    // 2. Capture screenshot ONLY if requested
    if (includeScreenshot) {
        try {
          const primaryDisplay = screen.getPrimaryDisplay();
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: primaryDisplay.size.width, height: primaryDisplay.size.height }});
          const primarySource = sources.find(source => source.display_id === primaryDisplay.id.toString() || source.id.startsWith('screen:'));

          if (primarySource) {
            const pngBuffer = primarySource.thumbnail.toPNG(); 
            screenshotDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
            console.log('[IPC] Screenshot captured.');
            // 3. Send screenshot image back to UI immediately
            if (mainWindow) {
                mainWindow.webContents.send('message-from-main', { text: screenshotDataUrl, isUser: false, isImage: true });
            } else {
                 console.warn("[IPC Handler] mainWindow became null before sending screenshot to UI.");
            }
          } else {
            console.error('[IPC] Primary screen source not found for screenshot.');
            if (mainWindow) {
                mainWindow.webContents.send('message-from-main', { text: '[Screenshot failed: Source not found]', isUser: false });
            }
          }
        } catch (error) {
          console.error('[IPC] Failed to capture screen:', error);
          if (mainWindow) {
             mainWindow.webContents.send('message-from-main', { text: '[Screenshot failed]', isUser: false });
          }
        }
    }

    // 4. Send message data (with or without screenshot) to backend
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (isStreaming) {
          console.warn("[WebSocket Send] Attempted to send new message while previous response is still streaming. Ignoring.");
          return; 
      }
      console.log("[WebSocket Send] Sending user_message to backend...");
      try {
        ws.send(JSON.stringify({ 
          type: 'user_message', 
          text: text, 
          screenshot_data_url: screenshotDataUrl // Send null if not captured
        }));
      } catch (error) {
         console.error('[WebSocket Send] Error sending data:', error);
         if (mainWindow) {
            mainWindow.webContents.send('message-from-main', { text: '[Error sending data to backend]', isUser: false });
         }
      }
    } else {
      console.error("[WebSocket Send] WebSocket not connected, cannot send message.");
      if (mainWindow) {
        mainWindow.webContents.send('message-from-main', { text: '[Cannot connect to backend]', isUser: false });
      }
    }
  });
  
  // --- Listener for tool response from renderer ---
  ipcMain.on('tool-response', (event, { toolCallId, decision, result }: { toolCallId: string, decision: 'approved' | 'denied', result?: string }) => {
      console.log(`[IPC] Received tool-response for ${toolCallId}. Decision: ${decision}`);
      
      const pendingCall = pendingToolCalls.get(toolCallId);
      if (!pendingCall) {
          console.error(`[IPC Handler] Received response for unknown toolCallId: ${toolCallId}`);
          return;
      }
      
      // Remove the call from pending once handled
      pendingToolCalls.delete(toolCallId);

      if (decision === 'approved') {
          // Execute the command
          let command = '';
          try {
              // IMPORTANT: Arguments are a JSON *string*. Parse it first.
              const args = JSON.parse(pendingCall.function.arguments);
              command = args.command; // Extract the actual command
              if (!command || typeof command !== 'string') {
                  throw new Error('Invalid command format in arguments.')
              }
              
              console.log(`[Exec] Running command for ${toolCallId}: ${command}`);
              exec(command, { timeout: 15000 }, (error, stdout, stderr) => { // Added timeout
                  if (error) {
                      console.error(`[Exec] Error executing command (${toolCallId}): ${error.message}`);
                      const errorMessage = `Execution Error: ${error.message}${stderr ? `\nStderr: ${stderr}` : ''}`;
                      // Send error result back to backend
                      sendToolResultToBackend(toolCallId, errorMessage);
                      // --- Send error result to frontend --- 
                      if (mainWindow) {
                          mainWindow.webContents.send('command-output-from-main', errorMessage);
                      }
                      // --- End send error to frontend ---
                      return;
                  }
                  const output = stdout || stderr; // Send stdout or stderr if stdout is empty
                  console.log(`[Exec] Command output (${toolCallId}): ${output.substring(0, 100)}...`);
                  // Send successful execution result back to backend
                  sendToolResultToBackend(toolCallId, output);
                  // --- Send success result to frontend --- 
                  if (mainWindow) {
                      mainWindow.webContents.send('command-output-from-main', output);
                  }
                  // --- End send success to frontend ---
              });

          } catch (parseError) {
              console.error(`[Exec] Error parsing arguments or invalid command for ${toolCallId}:`, parseError);
              const parseErrorMessage = `Execution Failed: Invalid arguments or command format.`;
              sendToolResultToBackend(toolCallId, parseErrorMessage);
              // --- Send parse error to frontend --- 
              if (mainWindow) {
                  mainWindow.webContents.send('command-output-from-main', parseErrorMessage);
              }
              // --- End send parse error to frontend ---
          }

      } else {
          // User denied execution
          const denialMessage = "User denied execution.";
          console.log(`[Exec] User denied execution for ${toolCallId}`);
          sendToolResultToBackend(toolCallId, denialMessage);
          // --- Send denial info to frontend --- 
          if (mainWindow) {
                mainWindow.webContents.send('command-output-from-main', denialMessage);
          }
          // --- End send denial to frontend ---
      }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
