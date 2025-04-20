// src/types.ts
import { IpcRendererEvent } from 'electron'; // Import IpcRendererEvent

// Define the structure for tool call objects
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string; // Arguments are initially a JSON string
    };
  }

// Define the structure for Agent Step Update data
export interface AgentStepUpdateData {
    thoughts?: string;
    action?: string;
    url?: string;
}
  
// Define the structure for a message object
export interface Message {
    text: string; // Holds text or screenshot data URL
    isUser: boolean;
    isImage?: boolean; // Flag for screenshot messages
    isToolRequest?: boolean; // Flag for tool request messages
    isCommandOutput?: boolean; // Flag for direct command output
    toolCalls?: ToolCall[]; // Array of tool calls if it's a request
    isAgentUpdate?: boolean; // Flag for agent status update messages
    isAgentResponse?: boolean; // Flag for user message sent in response to agent
    agentUpdateData?: AgentStepUpdateData; // Data for agent status updates
}
  
// Define the props for the ChatMessage component, including tool calls
export interface ChatMessageProps {
    text: string;
    isUser: boolean;
    isImage?: boolean;
    isToolRequest?: boolean;
    isCommandOutput?: boolean;
    toolCalls?: ToolCall[];
    onToolResponse?: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => void;
    isResponded: boolean; // Track if user responded to this specific tool request
    isAgentUpdate?: boolean;
    isAgentResponse?: boolean;
    agentUpdateData?: AgentStepUpdateData;
}

// Define the structure for sending a tool result back to main
export interface ToolResultPayload {
    type: 'tool_result';
    results: Array<{ tool_call_id: string; content: string; }>;
}

// Define the structure for cost update messages
export interface CostUpdatePayload {
    total_cost: number;
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
  // --- Agent Interaction API --- 
  onAgentQuestion: (callback: (event: IpcRendererEvent, data: { question: string; request_id: string }) => void) => void;
  onAgentStepUpdate: (callback: (event: IpcRendererEvent, data: AgentStepUpdateData) => void) => void;
  sendUserResponse: (requestId: string, answer: string) => void;
  // --- Cost Update Listener --- 
  onCostUpdate: (callback: (event: IpcRendererEvent, payload: CostUpdatePayload) => void) => void;
  // --- Send Message Trigger Listener ---
  onTriggerSendMessage: (callback: (event: IpcRendererEvent) => void) => void;
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
    // --- Agent Interaction Cleanup --- 
    removeAgentQuestionListener: () => void;
    removeAgentStepUpdateListener: () => void;
    // --- Cost Update Cleanup --- 
    removeCostUpdateListener: () => void;
    // --- Send Message Trigger Cleanup ---
    removeTriggerSendMessageListener: () => void;
}

// Extend the Window interface to include our exposed APIs
declare global {
  interface Window {
    electronAPI: IElectronAPI;
    cleanup: ICleanupAPI; // Add the cleanup API to the window object
  }
} 