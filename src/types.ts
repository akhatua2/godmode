// src/types.ts
import { IpcRendererEvent } from 'electron'; // Import IpcRendererEvent

// Define the structure for a message object used in App.tsx
export interface Message {
    text: string;
    isUser: boolean;
    isImage?: boolean; // Optional flag for image messages
    isToolRequest?: boolean; // Flag for tool request messages
    isCommandOutput?: boolean; // Flag for command output messages
    toolCalls?: ToolCall[]; // Optional array of tool calls for tool request messages
}

// Define the structure for props passed to ChatMessage component
export interface ChatMessageProps {
  text: string;
  isUser: boolean;
  isImage?: boolean;
  isToolRequest?: boolean;
  isCommandOutput?: boolean; 
  toolCalls?: ToolCall[];
  onToolResponse?: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => void;
  isResponded?: boolean; // Add this prop for button visibility
}

// Define the structure for a single tool call (matching OpenAI format)
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // Arguments are initially a string (JSON)
    };
}

// Define the structure for sending a tool result back to main
export interface ToolResultPayload {
    type: 'tool_result';
    results: Array<{ tool_call_id: string; content: string; }>;
}

// Interface for the API exposed by the preload script
export interface IElectronAPI {
  sendMessage: (text: string, includeScreenshot: boolean) => void;
  // Listener for regular messages, errors, images, connection status
  onMessageFromMain: (callback: (event: IpcRendererEvent, message: Message) => void) => void;
  // Listeners for streaming text responses
  onStreamStart: (callback: (event: IpcRendererEvent, message: { isUser: false }) => void) => void;
  onStreamChunk: (callback: (event: IpcRendererEvent, data: { delta: string }) => void) => void;
  onStreamEnd: (callback: () => void) => void;
  // Listener for tool call requests (run_bash_command) from the backend
  onToolCallRequestFromMain: (callback: (event: IpcRendererEvent, toolCalls: ToolCall[]) => void) => void;
  // Listeners for ask_user and terminate
  onAskUserRequestFromMain: (callback: (event: IpcRendererEvent, question: string) => void) => void;
  onTerminateRequestFromMain: (callback: (event: IpcRendererEvent, reason: string) => void) => void;
  // Listener for command output from main process
  onCommandOutputFromMain: (callback: (event: IpcRendererEvent, output: string) => void) => void;
  // Function to send tool results (or denial) back to the main process
  sendToolResponse: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => void;
}

// Interface for the cleanup functions exposed by the preload script
export interface ICleanupAPI {
    removeMessageListener: () => void;
    // Add new stream listener removers
    removeStreamStartListener: () => void;
    removeStreamChunkListener: () => void;
    removeStreamEndListener: () => void;
    // Add remover for the new tool call listener
    removeToolCallRequestListener: () => void;
    // Removers for ask_user and terminate
    removeAskUserRequestListener: () => void;
    removeTerminateRequestListener: () => void;
    // Remover for command output
    removeCommandOutputListener: () => void;
}

// Extend the Window interface to include our exposed APIs
declare global {
  interface Window {
    electronAPI: IElectronAPI;
    cleanup: ICleanupAPI; // Add the cleanup API to the window object
  }
} 