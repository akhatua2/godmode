// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Message, ToolCall, AgentStepUpdateData, CostUpdatePayload } from '../types'; // Import types

// --- Define types for new messages (Optional but recommended) ---

// --- End type definitions ---

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

// --- New Listeners for Agent Interaction ---
let agentQuestionListener: ((event: IpcRendererEvent, data: { question: string; request_id: string }) => void) | null = null;
let agentStepUpdateListener: ((event: IpcRendererEvent, data: AgentStepUpdateData) => void) | null = null;
// --- End New Listeners ---

// --- Cost Update Listener --- 
let costUpdateListener: ((event: IpcRendererEvent, payload: CostUpdatePayload) => void) | null = null;

// --- Listener for Send Message Trigger --- 
let triggerSendMessageListener: ((event: IpcRendererEvent) => void) | null = null;

// --- Listener for Paste from Clipboard --- 
let selectedTextContextListener: ((event: IpcRendererEvent, content: string) => void) | null = null;

// --- Listener for Transcription Result --- 
let transcriptionResultListener: ((event: IpcRendererEvent, text: string) => void) | null = null;

// --- Add variable for the backend status listener ---
let backendStatusListener: ((event: IpcRendererEvent, data: { statusType: string; text: string; }) => void) | null = null;

// --- Add variable for toast notification listener ---
let toastNotificationListener: ((event: IpcRendererEvent, data: { text: string }) => void) | null = null;

// --- electronAPI Definition ---
const electronAPI = {
  sendMessage: (text: string, includeScreenshot: boolean, contextText?: string | null) => {
      ipcRenderer.send('send-message', { text, includeScreenshot, contextText }); 
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
  
  // --- New Listener Functions for Agent --- 
  onAgentQuestion: (callback: (event: IpcRendererEvent, data: { question: string; request_id: string }) => void) => {
      if (agentQuestionListener) ipcRenderer.removeListener('agent-question-from-main', agentQuestionListener);
      agentQuestionListener = callback;
      ipcRenderer.on('agent-question-from-main', agentQuestionListener); // Define channel name
  },

  onAgentStepUpdate: (callback: (event: IpcRendererEvent, data: AgentStepUpdateData) => void) => {
      if (agentStepUpdateListener) ipcRenderer.removeListener('agent-step-update-from-main', agentStepUpdateListener);
      agentStepUpdateListener = callback;
      ipcRenderer.on('agent-step-update-from-main', agentStepUpdateListener); // Define channel name
  },
  // --- End New Listener Functions ---
  
  // Function to send tool response back to main process
  sendToolResponse: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => {
      console.log(`[Preload] Sending tool-response: ${toolCallId}, Decision: ${decision}`);
      ipcRenderer.send('tool-response', { toolCallId, decision, result });
  },
  
  // --- Function to send user response to agent question --- 
  sendUserResponse: (requestId: string, answer: string) => {
      console.log(`[Preload] Sending user-response: ${requestId}`);
      ipcRenderer.send('user-response', { request_id: requestId, answer: answer }); // Define channel name
  },

  // --- Cost Update Listener Setup ---
  onCostUpdate: (callback: (event: IpcRendererEvent, payload: CostUpdatePayload) => void) => {
      if (costUpdateListener) ipcRenderer.removeListener('cost-update-from-main', costUpdateListener);
      costUpdateListener = callback;
      ipcRenderer.on('cost-update-from-main', costUpdateListener);
  },

  // --- Send Message Trigger Listener Setup ---
  onTriggerSendMessage: (callback: (event: IpcRendererEvent) => void) => {
      if (triggerSendMessageListener) ipcRenderer.removeListener('trigger-send-message', triggerSendMessageListener);
      triggerSendMessageListener = callback;
      ipcRenderer.on('trigger-send-message', triggerSendMessageListener);
  },

  // --- Paste from Clipboard Listener Setup ---
  onSetSelectedTextContext: (callback: (event: IpcRendererEvent, content: string) => void) => {
      if (selectedTextContextListener) ipcRenderer.removeListener('set-selected-text-context', selectedTextContextListener);
      selectedTextContextListener = callback;
      ipcRenderer.on('set-selected-text-context', selectedTextContextListener);
  },

  // --- Function to set LLM model --- 
  setLlmModel: (modelName: string) => {
      console.log(`[Preload] Sending set-llm-model IPC: ${modelName}`);
      ipcRenderer.send('set-llm-model', modelName);
  },

  // --- Function to send audio data --- 
  sendAudioInput: (audioData: string, format: string) => {
      console.log(`[Preload] Sending send-audio-input IPC (format: ${format})`);
      ipcRenderer.send('send-audio-input', { audioData, format });
  },
  
  // --- Listener for transcription result --- 
  onTranscriptionResult: (callback: (event: IpcRendererEvent, text: string) => void) => {
      if (transcriptionResultListener) {
          ipcRenderer.removeListener('transcription-result-from-main', transcriptionResultListener);
      }
      transcriptionResultListener = callback;
      ipcRenderer.on('transcription-result-from-main', transcriptionResultListener);
  },

  // --- API Keys --- 
  sendApiKeys: (keys: { [provider: string]: string }) => ipcRenderer.send('send-api-keys', keys),
  
  // --- Start New Chat --- 
  startNewChat: () => {
    console.log('[Preload] Sending start-new-chat IPC');
    ipcRenderer.send('start-new-chat');
  },
  
  // --- Backend Status Listener ---
  onBackendStatusMessage: (callback: (event: IpcRendererEvent, data: { statusType: 'error' | 'warning' | 'info', text: string }) => void) => {
    if (backendStatusListener) ipcRenderer.removeListener('backend-status-message', backendStatusListener);
    backendStatusListener = callback;
    ipcRenderer.on('backend-status-message', backendStatusListener);
  },
  
  // --- Toast Notification Listener ---
  onToastNotification: (callback: (event: IpcRendererEvent, data: { text: string }) => void) => {
    if (toastNotificationListener) ipcRenderer.removeListener('toast-notification', toastNotificationListener);
    toastNotificationListener = callback;
    ipcRenderer.on('toast-notification', toastNotificationListener);
  },
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
    },
    // --- End command output remover ---

    // --- New Remover Functions ---
    removeAgentQuestionListener: () => {
         if (agentQuestionListener) {
              ipcRenderer.removeListener('agent-question-from-main', agentQuestionListener);
              agentQuestionListener = null;
         }
    },
    removeAgentStepUpdateListener: () => {
         if (agentStepUpdateListener) {
              ipcRenderer.removeListener('agent-step-update-from-main', agentStepUpdateListener);
              agentStepUpdateListener = null;
         }
    },
    // --- End New Remover Functions ---

    // --- Cost Update Remover ---
    removeCostUpdateListener: () => {
        if (costUpdateListener) {
            ipcRenderer.removeListener('cost-update-from-main', costUpdateListener);
            costUpdateListener = null;
        }
    },

    // --- Send Message Trigger Remover ---
    removeTriggerSendMessageListener: () => {
        if (triggerSendMessageListener) {
            ipcRenderer.removeListener('trigger-send-message', triggerSendMessageListener);
            triggerSendMessageListener = null;
        }
    },

    // --- Paste from Clipboard Remover ---
    removeSetSelectedTextContextListener: () => {
        if (selectedTextContextListener) {
            ipcRenderer.removeListener('set-selected-text-context', selectedTextContextListener);
            selectedTextContextListener = null;
        }
    },

    // --- Cleanup for Transcription Listener ---
    removeTranscriptionResultListener: () => {
        if (transcriptionResultListener) {
            ipcRenderer.removeListener('transcription-result-from-main', transcriptionResultListener);
            transcriptionResultListener = null;
        }
    },

    // --- API Keys Cleanup --- 
    removeSendApiKeysListener: () => ipcRenderer.removeAllListeners('send-api-keys-response-or-error'),
    // --- Backend Status Cleanup ---
    removeBackendStatusMessageListener: () => {
        if (backendStatusListener) ipcRenderer.removeListener('backend-status-message', backendStatusListener);
        backendStatusListener = null;
    },
    
    // --- Toast Notification Cleanup ---
    removeToastNotificationListener: () => {
      if (toastNotificationListener) ipcRenderer.removeListener('toast-notification', toastNotificationListener);
      toastNotificationListener = null;
    },
};

// --- Expose to Renderer --- 
// Use contextBridge to securely expose the API functions
try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  contextBridge.exposeInMainWorld('cleanup', cleanupAPI); // Expose the cleanup API with the correct name
} catch (error) {
  console.error('Failed to expose preload API:', error);
}
