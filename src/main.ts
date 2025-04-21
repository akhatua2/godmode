import { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut, clipboard } from 'electron';
import path from 'node:path';
import * as Path from 'node:path';
import WebSocket from 'ws';
// Import child_process for command execution (we'll use it later)
import { exec } from 'node:child_process';
import type { ToolCall, CostUpdatePayload } from './types'; // Import ToolCall type for storage
import { executeTool } from './tool-executor'; // Import the executor function
// Use ESM import for electron-squirrel-startup
import SquirrelStartup from 'electron-squirrel-startup';
import { v4 as uuidv4 } from 'uuid'; // ADDED

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-var-requires
// if (require('electron-squirrel-startup')) {
//   app.quit();
// }
if (SquirrelStartup) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let ws: WebSocket | null = null;
const backendBaseUrl = 'ws://127.0.0.1:8000/ws'; // Base URL
let isStreaming = false; // Flag to track if we are currently streaming a response

// --- Generate and store Chat ID --- 
let currentChatId: string = uuidv4(); // Generate initial chat ID
console.log(`[Main] Generated initial chat ID: ${currentChatId}`);
// --- End Chat ID --- 

// --- Store pending tool calls --- 
const pendingToolCalls = new Map<string, ToolCall>();

// --- Define Fn key globally (Attempt) ---
// const fnKey = 'Fn'; // REMOVED - Cannot be registered directly

function connectWebSocket() {
  // --- Construct URL with Chat ID --- 
  const backendUrlWithChatId = `${backendBaseUrl}?chat_id=${currentChatId}`;
  console.log('Attempting to connect to WebSocket:', backendUrlWithChatId); // Log the full URL
  ws = new WebSocket(backendUrlWithChatId); // Use the URL with chat ID
  // --- End URL Construction ---

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
          case 'warning': // Treat warnings like errors for UI display
              // Handle errors/warnings sent explicitly from backend
              isStreaming = false; // Stop streaming if an error occurs
              console.error(`[WebSocket] Received backend ${messageType}:`, messageData.content);
              // Use a specific message type for the UI
              mainWindow.webContents.send('backend-status-message', { statusType: messageType, text: messageData.content });
              break;
              
          case 'tool_call_request': // Specifically for run_bash_command now
               isStreaming = false; // Stop any active text streaming
               console.log('[WebSocket] Received tool_call_request:', messageData.tool_calls);
               const receivedToolCalls: ToolCall[] = messageData.tool_calls;
               if (receivedToolCalls && Array.isArray(receivedToolCalls)) {
                   receivedToolCalls.forEach((call: ToolCall) => {
                       if (call.id && call.type === 'function' && call.function?.name) { // Basic validation
                           // --- Auto-execute paste_at_cursor --- 
                           if (call.function.name === 'paste_at_cursor') {
                               console.log(`[Main] Auto-executing paste_at_cursor: ${call.id}`);
                               // Directly execute without asking user
                               executeTool(ws, mainWindow, call, 'approved'); 
                           } else {
                               // --- Store other client-side tools for approval --- 
                              pendingToolCalls.set(call.id, call);
                              console.log(`[Main] Stored pending tool call for approval: ${call.id} (${call.function.name})`);
                              // Forward the request to the renderer process for approval
                               console.log('[IPC] Sending tool-call-request-from-main for approval');
                               mainWindow?.webContents.send('tool-call-request-from-main', [call]); // Send only the one needing approval
                           }
                       } else {
                           console.error('[Main] Invalid tool call format in received list:', call);
                           pendingToolCalls.set(call.id, call);
                           console.log(`[Main] Stored pending tool call: ${call.id}`);
                       }
                   });
                   // Note: Forwarding to renderer now happens inside the loop for tools *requiring* approval.
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

          // --- Handle Agent Updates --- 
          case 'agent_question':
                isStreaming = false; // Stop any text stream
                const questionData = { question: messageData.question, request_id: messageData.request_id };
                console.log(`[IPC] Sending agent-question-from-main: ${questionData.request_id}`);
                mainWindow.webContents.send('agent-question-from-main', questionData);
                break;

            case 'agent_step_update':
                // Don't change isStreaming for step updates, they happen during agent processing
                const updateData = messageData.data; // Should contain thoughts, action, url
                console.log('[IPC] Sending agent-step-update-from-main');
                mainWindow.webContents.send('agent-step-update-from-main', updateData);
                break;
          // --- End Agent Update Handling ---

          // --- Handle Cost Update --- 
          case 'cost_update':
                const costPayload: CostUpdatePayload = { total_cost: messageData.total_cost };
                console.log(`[IPC] Sending cost-update-from-main: $${costPayload.total_cost.toFixed(6)}`);
                mainWindow.webContents.send('cost-update-from-main', costPayload);
                break;
          // --- End Cost Update Handling ---

          // --- Handle Transcription Result from Backend ---
          case 'transcription_result':
              const transcribedText = messageData.text;
              console.log(`[IPC] Sending transcription-result-from-main: ${transcribedText.substring(0, 50)}...`);
              mainWindow.webContents.send('transcription-result-from-main', transcribedText);
              break;
          // --- End Transcription Result Handling ---

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
    alwaysOnTop: true,
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

  // --- Register Global Shortcut for Sending Message ---
  const sendShortcut = 'CommandOrControl+K';
  const retSend = globalShortcut.register(sendShortcut, () => {
      console.log(`[GlobalShortcut] ${sendShortcut} pressed.`);
      if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('[IPC] Sending trigger-send-message');
          mainWindow.webContents.send('trigger-send-message');
      } else {
          console.warn(`[GlobalShortcut] ${sendShortcut} pressed, but mainWindow is not available.`);
      }
  });

  if (!retSend) {
      console.error(`[GlobalShortcut] Registration failed for ${sendShortcut}`);
  } else {
      console.log(`[GlobalShortcut] ${sendShortcut} registered successfully`);
  }
  // --- End Send Message Global Shortcut ---

  // --- Register Global Shortcut for Pasting --- 
  const pasteShortcut = 'CommandOrControl+U';
  const retPaste = globalShortcut.register(pasteShortcut, () => {
      console.log(`[GlobalShortcut] ${pasteShortcut} pressed.`);
      if (process.platform === 'darwin') { // macOS specific implementation
          // AppleScript to simulate Cmd+C
          const appleScriptCopy = 'tell application "System Events" to keystroke "c" using command down';
          
          // Use osascript to execute the AppleScript
          exec(`osascript -e '${appleScriptCopy}'`, (error, stdout, stderr) => {
              if (error) {
                  console.error(`[GlobalShortcut] osascript error simulating copy: ${error.message}`);
                  return;
              }
              if (stderr) {
                  console.error(`[GlobalShortcut] osascript stderr simulating copy: ${stderr}`);
                  // Continue anyway, maybe copy still worked
              }
              
              // Introduce a tiny delay to allow the clipboard to update
              setTimeout(() => {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                      const selectedText = clipboard.readText(); // Read the result of the Cmd+C
                      if (selectedText) {
                          console.log('[IPC] Sending set-selected-text-context with selected text');
                          mainWindow.webContents.send('set-selected-text-context', selectedText);
                      } else {
                          console.log('[GlobalShortcut] Clipboard empty after simulated copy, likely no text selected.');
                      }
                  } else {
                     console.warn(`[GlobalShortcut] ${pasteShortcut} - mainWindow not available after copy simulation.`);
                  }
              }, 100); // 100ms delay - adjust if needed
          });
      } else { // Fallback for non-macOS (optional - could just do nothing)
         console.warn(`[GlobalShortcut] ${pasteShortcut} - Get selected text only implemented for macOS.`);
         // Optionally, fall back to standard clipboard paste on other OSes
         // if (mainWindow && !mainWindow.isDestroyed()) {
         //     const clipboardText = clipboard.readText();
         //     if (clipboardText) {
         //         console.log('[IPC] Sending paste-from-clipboard (non-macOS fallback)');
         //         mainWindow.webContents.send('paste-from-clipboard', clipboardText);
         //     }
         // }
      }
  });

  if (!retPaste) {
      console.error(`[GlobalShortcut] Registration failed for ${pasteShortcut}`);
  } else {
      console.log(`[GlobalShortcut] ${pasteShortcut} registered successfully`);
  }
  // --- End Paste Global Shortcut ---

  // --- Register Global Shortcut for Fn Key (Attempt) --- REMOVED ---
  /* 
  let isFnDown = false; 
  const retFn = globalShortcut.register(fnKey, () => { ... });
  if (!retFn) { ... } else { ... }
  */
  // --- End Fn Key Global Shortcut ---

  ipcMain.on('send-message', async (event, { text, includeScreenshot, contextText }: { text: string, includeScreenshot: boolean, contextText: string | null }) => {
    console.log(`[IPC] Received send-message: '${text}', Include Screenshot: ${includeScreenshot}, Context Provided: ${!!contextText}`);
    
    // 1. Send user message back to UI immediately (without context, UI handles display)
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
        // --- Hide window, capture, show window --- 
        if (mainWindow) {
            try {
                mainWindow.hide();
                // Wait a short moment for the window to actually hide
                await new Promise(resolve => setTimeout(resolve, 50)); // Reduced delay

                const primaryDisplay = screen.getPrimaryDisplay();
                const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: primaryDisplay.size.width, height: primaryDisplay.size.height }});
                const primarySource = sources.find(source => source.display_id === primaryDisplay.id.toString() || source.id.startsWith('screen:'));

                if (primarySource) {
                    const pngBuffer = primarySource.thumbnail.toPNG(); 
                    screenshotDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
                    console.log('[IPC] Screenshot captured (window was hidden).');
                    // --- Resize the image --- 
                    const originalImage = primarySource.thumbnail;
                    const originalSize = originalImage.getSize();
                    const maxDimension = 1024; // Max width or height

                    let newWidth, newHeight;
                    if (originalSize.width > originalSize.height) {
                        newWidth = Math.min(originalSize.width, maxDimension);
                        newHeight = Math.round(newWidth / originalSize.width * originalSize.height);
                    } else {
                        newHeight = Math.min(originalSize.height, maxDimension);
                        newWidth = Math.round(newHeight / originalSize.height * originalSize.width);
                    }

                    // Ensure dimensions are at least 1x1
                    newWidth = Math.max(1, newWidth);
                    newHeight = Math.max(1, newHeight);

                    console.log(`[IPC] Resizing screenshot from ${originalSize.width}x${originalSize.height} to ${newWidth}x${newHeight}`);

                    // Resize (quality 'good' is default)
                    const resizedImage = originalImage.resize({ width: newWidth, height: newHeight, quality: 'good' });
                    
                    // Encode the *resized* image
                    const resizedPngBuffer = resizedImage.toPNG(); 
                    screenshotDataUrl = `data:image/png;base64,${resizedPngBuffer.toString('base64')}`;
                    console.log('[IPC] Resized screenshot captured.');
                    // --- End Resize --- 
                    // Send screenshot back to UI immediately (optional to do it here)
                    // mainWindow.webContents.send('message-from-main', { text: screenshotDataUrl, isUser: false, isImage: true });
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
            } finally {
                // IMPORTANT: Ensure the window is shown again even if errors occurred
                if(mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.show();
                    console.log('[IPC] Window shown again.');
                }
            }
        } else {
            console.error('[IPC] Cannot hide/show window for screenshot: mainWindow is null.');
        }
         // --- End Hide/Capture/Show --- 
        
        // Send screenshot back to UI *after* showing window again (or keep sending inside try block)
        if (mainWindow && screenshotDataUrl) {
            mainWindow.webContents.send('message-from-main', { text: screenshotDataUrl, isUser: false, isImage: true });
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
          screenshot_data_url: screenshotDataUrl, // Send null if not captured
          context_text: contextText // Include the context text
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
  
  // --- IPC Listener for Audio Input from Renderer ---
  ipcMain.on('send-audio-input', (event, { audioData, format }: { audioData: string, format: string }) => {
    console.log(`[IPC] Received send-audio-input (format: ${format})`);
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({
                type: 'audio_input',
                audio_data: audioData,
                format: format
            }));
            console.log('[WebSocket Send] Sent audio_input to backend.');
            // Optionally, notify the UI that transcription is in progress
            // mainWindow?.webContents.send('backend-status-message', { statusType: 'info', text: 'Transcribing audio...' });
        } catch (error) {
            console.error('[WebSocket Send] Error sending audio_input:', error);
            mainWindow?.webContents.send('backend-status-message', { statusType: 'error', text: 'Failed to send audio to backend.' });
        }
    } else {
        console.error('[WebSocket Send] Cannot send audio_input, WebSocket not connected.');
        mainWindow?.webContents.send('backend-status-message', { statusType: 'error', text: 'Cannot send audio, connection lost.' });
    }
  });
  // --- End Audio Input Listener ---

  // --- Listener for tool response from renderer ---
  ipcMain.on('tool-response', (event, { toolCallId, decision, result }: { toolCallId: string, decision: 'approved' | 'denied', result?: string }) => {
      console.log(`[IPC] Received tool-response for ${toolCallId}. Decision: ${decision}`);
      
      const pendingCall = pendingToolCalls.get(toolCallId);
      if (!pendingCall) {
          console.error(`[IPC Handler] Received response for unknown toolCallId: ${toolCallId}`);
          return;
      }
      
      // Remove the call from pending once received
      pendingToolCalls.delete(toolCallId);

      // Use the external executor function
      executeTool(ws, mainWindow, pendingCall, decision);
  });

  // --- Listener for user response to agent question ---
  ipcMain.on('user-response', (event, { request_id, answer }: { request_id: string, answer: string }) => {
      console.log(`[IPC] Received user-response for request_id: ${request_id}`);
      if (ws && ws.readyState === WebSocket.OPEN) {
          try {
              ws.send(JSON.stringify({
                  type: 'user_response',
                  request_id: request_id,
                  answer: answer
              }));
              console.log('[WebSocket Send] Sent user_response to backend.');
              // Optionally send a confirmation back to UI that the response was sent
              // mainWindow?.webContents.send('message-from-main', { text: answer, isUser: true, isAgentResponse: true });
          } catch (error) {
              console.error('[WebSocket Send] Error sending user_response:', error);
              mainWindow?.webContents.send('backend-status-message', { statusType: 'error', text: 'Failed to send response to backend.' });
          }
      } else {
          console.error('[WebSocket Send] Cannot send user_response, WebSocket not connected.');
          mainWindow?.webContents.send('backend-status-message', { statusType: 'error', text: 'Cannot send response, connection lost.' });
      }
  });
  // --- End user-response listener ---

  // --- Listener for setting LLM Model --- 
  ipcMain.on('set-llm-model', (event, modelName: string) => {
    console.log(`[IPC] Received set-llm-model request: ${modelName}`);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ 
          type: 'set_llm_model', 
          model_name: modelName
        }));
        console.log("[WebSocket Send] Sent set_llm_model to backend.");
      } catch (error) {
         console.error('[WebSocket Send] Error sending set_llm_model:', error);
         // Optionally notify renderer of error
         // mainWindow?.webContents.send('backend-status-message', { statusType: 'error', text: 'Failed to send model selection to backend.' });
      }
    } else {
      console.error("[WebSocket Send] Cannot send set_llm_model, WebSocket not connected.");
      // Optionally notify renderer
      // mainWindow?.webContents.send('backend-status-message', { statusType: 'error', text: 'Cannot send model selection, connection lost.' });
    }
  });
  // --- End set-llm-model listener ---
});

// --- Unregister Shortcut on Quit --- 
app.on('will-quit', () => {
  // Unregister a specific accelerator
  // Feature removed: CommandOrControl+I for paste
  // globalShortcut.unregister('CommandOrControl+I');
  // console.log('[GlobalShortcut] CommandOrControl+I unregistered.');

  // --- Unregister Send Shortcut ---
  const sendShortcut = 'CommandOrControl+K';
  globalShortcut.unregister(sendShortcut);
  console.log(`[GlobalShortcut] ${sendShortcut} unregistered.`);
  // --- End Unregister Send Shortcut ---

  // --- Unregister Paste Shortcut ---
  const pasteShortcut = 'CommandOrControl+I';
  globalShortcut.unregister(pasteShortcut);
  console.log(`[GlobalShortcut] ${pasteShortcut} unregistered.`);
  // --- End Unregister Paste Shortcut ---

  // --- Unregister Fn Key Shortcut --- REMOVED ---
  // globalShortcut.unregister(fnKey);
  // console.log(`[GlobalShortcut] ${fnKey} unregistered (attempted).`);
  // --- End Unregister Fn Key Shortcut --- 

  // Unregister all accelerators
  globalShortcut.unregisterAll(); // Keep this as a fallback
  console.log('[GlobalShortcut] All shortcuts unregistered.');
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
