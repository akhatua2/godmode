// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Message, ToolCall } from './types'; // Import types

// Store listener functions to allow removal
let messageListener: ((event: IpcRendererEvent, message: Message) => void) | null = null;
let streamStartListener: ((event: IpcRendererEvent, message: { isUser: false }) => void) | null = null;
let streamChunkListener: ((event: IpcRendererEvent, data: { delta: string }) => void) | null = null;
let streamEndListener: (() => void) | null = null;
let toolCallRequestListener: ((event: IpcRendererEvent, toolCalls: ToolCall[]) => void) | null = null;
// --- Add listeners for new tool requests --- 
let askUserRequestListener: ((event: IpcRendererEvent, question: string) => void) | null = null;
let terminateRequestListener: ((event: IpcRendererEvent, reason: string) => void) | null = null;
// Add listener for command output
let commandOutputListener: ((event: IpcRendererEvent, output: string) => void) | null = null;

// --- electronAPI Definition ---
const electronAPI = {
  sendMessage: (text: string, includeScreenshot: boolean) => {
      ipcRenderer.send('send-message', { text, includeScreenshot }); 
  },
  onMessageFromMain: (callback: (event: IpcRendererEvent, message: Message) => void) => {
    // Remove existing listener if any before adding a new one
    if (messageListener) {
      ipcRenderer.removeListener('message-from-main', messageListener);
    }
    messageListener = callback;
    ipcRenderer.on('message-from-main', messageListener);
  },
  // Add listeners for stream events
  onStreamStart: (callback: (event: IpcRendererEvent, message: { isUser: false }) => void) => {
    if (streamStartListener) {
        ipcRenderer.removeListener('stream-start', streamStartListener);
    }
    streamStartListener = callback;
    ipcRenderer.on('stream-start', streamStartListener);
  },
  onStreamChunk: (callback: (event: IpcRendererEvent, data: { delta: string }) => void) => {
    if (streamChunkListener) {
        ipcRenderer.removeListener('stream-chunk', streamChunkListener);
    }
    streamChunkListener = callback;
    ipcRenderer.on('stream-chunk', streamChunkListener);
  },
  onStreamEnd: (callback: () => void) => {
    if (streamEndListener) {
        ipcRenderer.removeListener('stream-end', streamEndListener);
    }
    streamEndListener = callback;
    ipcRenderer.on('stream-end', streamEndListener);
  },
  
  // Tool call listener (for run_bash_command)
  onToolCallRequestFromMain: (callback: (event: IpcRendererEvent, toolCalls: ToolCall[]) => void) => {
    if (toolCallRequestListener) ipcRenderer.removeListener('tool-call-request-from-main', toolCallRequestListener);
    toolCallRequestListener = callback;
    // Ensure the channel name matches main process
    ipcRenderer.on('tool-call-request-from-main', toolCallRequestListener);
  },
  
  // --- New listener functions ---
  onAskUserRequestFromMain: (callback: (event: IpcRendererEvent, question: string) => void) => {
    if (askUserRequestListener) ipcRenderer.removeListener('ask-user-request-from-main', askUserRequestListener);
    askUserRequestListener = callback;
    // Ensure the channel name matches main process
    ipcRenderer.on('ask-user-request-from-main', askUserRequestListener);
  },
  
  onTerminateRequestFromMain: (callback: (event: IpcRendererEvent, reason: string) => void) => {
      if (terminateRequestListener) ipcRenderer.removeListener('terminate-request-from-main', terminateRequestListener);
      terminateRequestListener = callback;
      // Ensure the channel name matches main process
      ipcRenderer.on('terminate-request-from-main', terminateRequestListener);
  },
  // --- End new listener functions ---
  
  // --- Add command output listener ---
  onCommandOutputFromMain: (callback: (event: IpcRendererEvent, output: string) => void) => {
      if (commandOutputListener) ipcRenderer.removeListener('command-output-from-main', commandOutputListener);
      commandOutputListener = callback;
      ipcRenderer.on('command-output-from-main', commandOutputListener);
  },
  // --- End command output listener ---
  
  // Function to send tool response back to main process
  sendToolResponse: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => {
      console.log(`[Preload] Sending tool-response: ${toolCallId}, Decision: ${decision}`);
      ipcRenderer.send('tool-response', { toolCallId, decision, result });
  }
};

// --- cleanup API Definition ---
const cleanupAPI = {
    removeMessageListener: () => {
        if (messageListener) {
            ipcRenderer.removeListener('message-from-main', messageListener);
            messageListener = null;
        }
    },
    // Add functions to remove stream listeners
    removeStreamStartListener: () => {
        if (streamStartListener) {
            ipcRenderer.removeListener('stream-start', streamStartListener);
            streamStartListener = null;
        }
    },
    removeStreamChunkListener: () => {
        if (streamChunkListener) {
            ipcRenderer.removeListener('stream-chunk', streamChunkListener);
            streamChunkListener = null;
        }
    },
    removeStreamEndListener: () => {
        if (streamEndListener) {
            ipcRenderer.removeListener('stream-end', streamEndListener);
            streamEndListener = null;
        }
    },
    // Add remover for tool call listener
    removeToolCallRequestListener: () => {
        if (toolCallRequestListener) {
             ipcRenderer.removeListener('tool-call-request-from-main', toolCallRequestListener);
             toolCallRequestListener = null;
        }
    },
    // --- New remover functions ---
    removeAskUserRequestListener: () => {
        if (askUserRequestListener) {
            ipcRenderer.removeListener('ask-user-request-from-main', askUserRequestListener);
            askUserRequestListener = null;
        }
    },
    removeTerminateRequestListener: () => {
        if (terminateRequestListener) {
            ipcRenderer.removeListener('terminate-request-from-main', terminateRequestListener);
            terminateRequestListener = null;
        }
    },
    // --- Add command output remover ---
    removeCommandOutputListener: () => {
        if (commandOutputListener) {
            ipcRenderer.removeListener('command-output-from-main', commandOutputListener);
            commandOutputListener = null;
        }
    }
    // --- End command output remover ---
};

// --- Expose to Renderer --- 
// Use contextBridge to securely expose the API functions
try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  contextBridge.exposeInMainWorld('cleanup', cleanupAPI); // Expose the cleanup API
} catch (error) {
  console.error('Failed to expose preload API:', error);
}
