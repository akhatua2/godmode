import WebSocket from 'ws';
import { exec } from 'node:child_process';
import { BrowserWindow, clipboard } from 'electron';
import fs from 'node:fs/promises'; // Import fs for file operations
import path from 'node:path'; // Import path for joining
import os from 'os'; // Import os for homedir
import type { ToolCall } from '../types'; // Assuming types.ts is in the same directory or adjust path

/**
 * Sends the result of a tool execution back to the backend via WebSocket.
 */
export function sendToolResultToBackend(ws: WebSocket | null, mainWindow: BrowserWindow | null, toolCallId: string, content: string) {
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

/**
 * Executes a tool based on the provided ToolCall object and decision.
 * Currently handles 'run_bash_command'.
 */
export function executeTool(ws: WebSocket | null, mainWindow: BrowserWindow | null, pendingCall: ToolCall, decision: 'approved' | 'denied') {
    if (decision === 'approved') {
        // --- Handle Specific Tool Types ---
        if (pendingCall.function.name === 'run_bash_command') {
            executeBashCommand(ws, mainWindow, pendingCall);
        } else if (pendingCall.function.name === 'read_file') {
            // Placeholder for read_file execution logic (client-side)
             console.log(`[Tool Executor] Received request to execute read_file for ID: ${pendingCall.id}. Client-side execution needed.`);
             // For now, just acknowledge - actual read happens based on renderer logic triggered by this approval.
             // We might send a different kind of message back or just let the renderer handle it.
             // Let's send a placeholder result indicating client needs to act.
             handleReadFile(ws, mainWindow, pendingCall); // Call the actual handler
        } else if (pendingCall.function.name === 'edit_file') {
             // Placeholder for edit_file execution logic (client-side)
             console.log(`[Tool Executor] Received request to execute edit_file for ID: ${pendingCall.id}. Client-side execution needed.`);
             // Similar to read_file, acknowledge and indicate client needs to act.
             handleEditFile(ws, mainWindow, pendingCall); // Call the actual handler
        } else if (pendingCall.function.name === 'paste_at_cursor') {
            handlePasteAtCursor(ws, mainWindow, pendingCall); // Call the new handler
        } else {
            console.warn(`[Tool Executor] Attempted to execute unknown tool: ${pendingCall.function.name}`);
            const errorMessage = `Execution Failed: Unknown tool '${pendingCall.function.name}'.`;
            sendToolResultToBackend(ws, mainWindow, pendingCall.id, errorMessage);
             if (mainWindow) {
                mainWindow.webContents.send('command-output-from-main', errorMessage);
            }
        }
        // --- End Tool Type Handling ---

    } else {
        // User denied execution
        const denialMessage = "User denied execution.";
        console.log(`[Tool Executor] User denied execution for ${pendingCall.id}`);
        sendToolResultToBackend(ws, mainWindow, pendingCall.id, denialMessage);
        // --- Send denial info to frontend ---
        if (mainWindow) {
            mainWindow.webContents.send('command-output-from-main', denialMessage);
        }
        // --- End send denial to frontend ---
    }
}


/**
 * Specific function to handle execution of 'run_bash_command'.
 */
function executeBashCommand(ws: WebSocket | null, mainWindow: BrowserWindow | null, pendingCall: ToolCall) {
    const toolCallId = pendingCall.id;
    let command = '';
    try {
        // IMPORTANT: Arguments are a JSON *string*. Parse it first.
        const args = JSON.parse(pendingCall.function.arguments);
        command = args.command; // Extract the actual command
        if (!command || typeof command !== 'string') {
            throw new Error('Invalid command format in arguments.')
        }

        // --- Prepare execution options and command ---
        const executionOptions = {
            timeout: 15000,
            cwd: process.cwd() // Use current working directory instead of hardcoded Desktop path
        };
        // Construct the command to run via conda run
        const commandToExecuteInConda = `conda run -n base ${command}`;
        // --- End preparation ---

        console.log(`[Exec] Running in conda env 'base', cwd '${process.cwd()}': ${commandToExecuteInConda}`);
        // Use the new command and options
        exec(commandToExecuteInConda, executionOptions, (error, stdout, stderr) => {
            if (error) {
                // Check if it's a conda error (e.g., env not found)
                if (error.message.includes('conda run') || error.message.includes('CondaValueError')) {
                    console.error(`[Exec] Conda error (${toolCallId}): ${error.message}`);
                } else {
                    console.error(`[Exec] Error executing command (${toolCallId}): ${error.message}`);
                }
                const errorMessage = `Execution Error: ${error.message}${stderr ? `Stderr: ${stderr}` : ''}`;
                // Send error result back to backend
                sendToolResultToBackend(ws, mainWindow, toolCallId, errorMessage);
                // --- Send error result to frontend ---
                if (mainWindow) {
                    mainWindow.webContents.send('command-output-from-main', errorMessage);
                }
                // --- End send error to frontend ---
                return;
            }
            const output = stdout || stderr; // Send stdout or stderr if stdout is empty
            const truncatedOutput = output.substring(0, 1000) + '...'; // Limit to first 1000 chars
            console.log(`[Exec] Command output (${toolCallId}): ${truncatedOutput}`);
            // Send successful execution result back to backend
            sendToolResultToBackend(ws, mainWindow, toolCallId, truncatedOutput);
            // --- Send success result to frontend ---
            if (mainWindow) {
                mainWindow.webContents.send('command-output-from-main', truncatedOutput);
            }
            // --- End send success to frontend ---
        });

    } catch (parseError) {
        console.error(`[Exec] Error parsing arguments or invalid command for ${toolCallId}:`, parseError);
        const parseErrorMessage = `Execution Failed: Invalid arguments or command format.`;
        sendToolResultToBackend(ws, mainWindow, toolCallId, parseErrorMessage);
        // --- Send parse error to frontend ---
        if (mainWindow) {
            mainWindow.webContents.send('command-output-from-main', parseErrorMessage);
        }
        // --- End send parse error to frontend ---
    }
}

// Add functions for handling read_file and edit_file if needed server-side in main process
// (Though usually these might be better handled purely based on renderer interaction after approval)

// --- File Read Handler ---
async function handleReadFile(ws: WebSocket | null, mainWindow: BrowserWindow | null, pendingCall: ToolCall) {
    const toolCallId = pendingCall.id;
    let filePathArg = '';
    try {
        const args = JSON.parse(pendingCall.function.arguments);
        filePathArg = args.file_path;
        if (!filePathArg || typeof filePathArg !== 'string') {
             throw new Error('Invalid file_path argument.');
        }
        
        // Expand ~ to home directory and normalize the path
        const expandedPath = filePathArg.replace(/^~/, os.homedir());
        const absolutePath = path.normalize(expandedPath);
        console.log(`[Tool Executor] Attempting to read file: ${absolutePath}`);

        const content = await fs.readFile(absolutePath, 'utf-8');
        const truncatedContent = content.length > 2000 ? content.substring(0, 2000) + '... [truncated]' : content;

        console.log(`[Tool Executor] Successfully read file ${absolutePath}. Content length: ${content.length}`);
        sendToolResultToBackend(ws, mainWindow, toolCallId, truncatedContent);
        if (mainWindow) {
            mainWindow.webContents.send('command-output-from-main', `Successfully read file: ${filePathArg}`);
        }

    } catch (error: any) {
        console.error(`[Tool Executor] Error reading file for ${toolCallId} (Path: ${filePathArg}):`, error);
        const errorMessage = `File Read Error: ${error.message}`;
        sendToolResultToBackend(ws, mainWindow, toolCallId, errorMessage);
        if (mainWindow) {
            mainWindow.webContents.send('command-output-from-main', errorMessage);
        }
    }
}
// --- End File Read Handler ---

// --- File Edit Handler ---
async function handleEditFile(ws: WebSocket | null, mainWindow: BrowserWindow | null, pendingCall: ToolCall) {
    const toolCallId = pendingCall.id;
    let filePathArg = '';
    let stringToReplace = '';
    let newString = '';
    try {
        const rawArgs = pendingCall.function.arguments;
        console.log(`[Tool Executor DEBUG] Raw arguments for edit_file: ${rawArgs}`);
        const args = JSON.parse(rawArgs);
        console.log(`[Tool Executor DEBUG] Parsed arguments for edit_file:`, args);

        filePathArg = args.file_path;
        stringToReplace = args.string_to_replace;
        newString = args.new_string;

        if (!filePathArg || typeof filePathArg !== 'string') {
            throw new Error('Invalid file_path argument.');
        }
        if (typeof stringToReplace !== 'string') {
            throw new Error('Invalid string_to_replace argument.');
        }
        if (typeof newString !== 'string') {
            throw new Error('Invalid new_string argument.');
        }
        
        // Use the path as is, ensuring it's normalized
        const absolutePath = path.normalize(filePathArg);
        console.log(`[Tool Executor] Attempting to edit file: ${absolutePath}`);

        // Read the current content
        const currentContent = await fs.readFile(absolutePath, 'utf-8');

        // Perform the replacement (first occurrence only)
        const modifiedContent = currentContent.replace(stringToReplace, newString);

        if (modifiedContent === currentContent) {
            throw new Error(`String not found in file: "${stringToReplace.substring(0, 50)}${stringToReplace.length > 50 ? '...' : ''}"`);
        }

        // Write the modified content back
        await fs.writeFile(absolutePath, modifiedContent, 'utf-8');

        const successMessage = `Successfully replaced string in file: ${filePathArg}`;
        console.log(`[Tool Executor] ${successMessage}`);
        sendToolResultToBackend(ws, mainWindow, toolCallId, successMessage);
        if (mainWindow) {
            mainWindow.webContents.send('command-output-from-main', successMessage);
        }

    } catch (error: any) {
        console.error(`[Tool Executor] Error editing file for ${toolCallId} (Path: ${filePathArg}):`, error);
        const errorMessage = `File Edit Error: ${error.message}`;
        sendToolResultToBackend(ws, mainWindow, toolCallId, errorMessage);
        if (mainWindow) {
            mainWindow.webContents.send('command-output-from-main', errorMessage);
        }
    }
}

// --- Paste at Cursor Handler ---
async function handlePasteAtCursor(ws: WebSocket | null, mainWindow: BrowserWindow | null, pendingCall: ToolCall) {
    const toolCallId = pendingCall.id;
    let contentToPaste = '';

    try {
        const rawArgs = pendingCall.function.arguments;
        const args = JSON.parse(rawArgs);
        contentToPaste = args.content_to_paste;
        // *** LOG 1: Content intended by LLM ***
        console.log(`[Tool Executor LOG 1 (${toolCallId})] Content to paste from LLM: "${contentToPaste.substring(0, 50)}..."`);

        if (typeof contentToPaste !== 'string') {
            throw new Error('Invalid content_to_paste argument.');
        }

        // Step 2: Write new content to clipboard
        clipboard.writeText(contentToPaste);
        // *** LOG 2: Clipboard content AFTER writing LLM content ***
        const clipboardAfterWrite = clipboard.readText();
        console.log(`[Tool Executor LOG 2 (${toolCallId})] Clipboard content AFTER writing LLM content: "${clipboardAfterWrite.substring(0, 50)}..."`);

        // Step 3: Simulate Paste
        const appleScriptCommand = `osascript -e 'tell application "System Events" to keystroke "v" using command down'`;

        // *** LOG 3: Clipboard content BEFORE simulating paste ***
        const clipboardBeforePaste = clipboard.readText();
        console.log(`[Tool Executor LOG 3 (${toolCallId})] Clipboard content BEFORE simulating paste: "${clipboardBeforePaste.substring(0, 50)}..."`);
        
        // Introduce a delay before simulating paste
        setTimeout(() => {
          console.log(`[Tool Executor (${toolCallId})] Executing AppleScript after delay...`);
          
          exec(appleScriptCommand, (error, stdout, stderr) => {
              // --- Callback Start ---
              // *** LOG 4: Clipboard content IMMEDIATELY inside callback ***
              const clipboardInsideCallback = clipboard.readText();
              console.log(`[Tool Executor LOG 4 (${toolCallId})] Clipboard content START of paste callback: "${clipboardInsideCallback.substring(0, 50)}..."`);
              
              let operationSucceeded = true;
              let resultMessage = '';

              if (error) {
                  operationSucceeded = false;
                  console.error(`[Tool Executor] AppleScript paste error (${toolCallId}): ${error.message}`);
                  resultMessage = `Paste Error: Failed to simulate paste action - ${error.message}`;
              } else {
                  if (stderr) {
                       console.warn(`[Tool Executor] AppleScript paste stderr (${toolCallId}): ${stderr}`);
                  }
                  resultMessage = `Successfully pasted content.`;
                  console.log(`[Tool Executor] ${resultMessage}`);
              }

              // Send result (success or error) back to backend
              sendToolResultToBackend(ws, mainWindow, toolCallId, resultMessage);
              // Send result to frontend - REMOVE SUCCESS MESSAGE
              /*
              if (mainWindow && operationSucceeded) { // Only remove success case
                  mainWindow.webContents.send('command-output-from-main', resultMessage);
              }
              */
             // Still send errors to frontend if needed
             if (mainWindow && !operationSucceeded) {
                 mainWindow.webContents.send('command-output-from-main', resultMessage);
             }

              // --- Callback End ---
          });
        }, 150); // Delay in milliseconds (adjust if needed)

    } catch (error: any) {
        console.error(`[Tool Executor] Error handling paste_at_cursor for ${toolCallId}:`, error);
        const errorMessage = `Paste Handler Error: ${error.message}`;
        sendToolResultToBackend(ws, mainWindow, toolCallId, errorMessage);
         if (mainWindow) {
            mainWindow.webContents.send('command-output-from-main', errorMessage);
        }
    }
}
// --- End Paste at Cursor Handler ---
