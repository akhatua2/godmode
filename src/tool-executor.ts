import WebSocket from 'ws';
import { exec } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs/promises'; // Import fs for file operations
import path from 'node:path'; // Import path for joining
import type { ToolCall } from './types'; // Assuming types.ts is in the same directory or adjust path

// Define a base path (e.g., user's Desktop) for relative paths
// IMPORTANT: Make this configurable or dynamic in a real app!
const BASE_WORKING_DIR = '/Users/arpan/Desktop';

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
            cwd: '/Users/arpan/Desktop' // TODO: arpandeepk Set the working directory (Consider making this configurable)
        };
        // Construct the command to run via conda run
        const commandToExecuteInConda = `conda run -n base ${command}`;
        // --- End preparation ---

        console.log(`[Exec] Running in conda env 'base', cwd '/Users/arpan/Desktop': ${commandToExecuteInConda}`);
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
        
        let absolutePath: string;
        if (path.isAbsolute(filePathArg)) {
            absolutePath = path.normalize(filePathArg); // Normalize absolute path
        } else {
            absolutePath = path.join(BASE_WORKING_DIR, filePathArg); // Join relative path
        }
        console.log(`[Tool Executor] Attempting to read file: ${absolutePath} (Original: ${filePathArg})`);

        // Security Check: Ensure the path doesn't escape the base directory (basic check)
        if (!absolutePath.startsWith(BASE_WORKING_DIR)) {
             throw new Error('Access denied: Path is outside the allowed directory.');
        }

        const content = await fs.readFile(absolutePath, 'utf-8');
        const truncatedContent = content.length > 2000 ? content.substring(0, 2000) + '... [truncated]' : content;

        console.log(`[Tool Executor] Successfully read file ${absolutePath}. Content length: ${content.length}`);
        sendToolResultToBackend(ws, mainWindow, toolCallId, truncatedContent); // Send truncated content back
        if (mainWindow) {
            // Send confirmation to frontend
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
        if (typeof newString !== 'string') { // Allow empty string for deletion
            throw new Error('Invalid new_string argument.');
        }
        
        let absolutePath: string;
        if (path.isAbsolute(filePathArg)) {
            absolutePath = path.normalize(filePathArg); // Normalize absolute path
        } else {
            absolutePath = path.join(BASE_WORKING_DIR, filePathArg); // Join relative path
        }
        console.log(`[Tool Executor] Attempting to edit file: ${absolutePath} (Original: ${filePathArg})`);

         // Security Check: Ensure the path doesn't escape the base directory (basic check)
        if (!absolutePath.startsWith(BASE_WORKING_DIR)) {
             throw new Error('Access denied: Path is outside the allowed directory.');
        }

        // Read the current content
        const currentContent = await fs.readFile(absolutePath, 'utf-8');

        // Perform the replacement (first occurrence only)
        const modifiedContent = currentContent.replace(stringToReplace, newString);

        if (modifiedContent === currentContent) {
            // If the content hasn't changed, the string wasn't found
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
