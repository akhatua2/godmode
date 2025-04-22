// Type Definitions (example: src/types.d.ts)

// ... other types ...

// Define the interface for the API exposed by preload.ts
export interface IElectronAPI {
  sendMessage: (text: string, includeScreenshot: boolean, contextText?: string | null) => void;
  onMessageFromMain: (callback: (event: any, message: Message) => void) => void;
  onStreamStart: (callback: (event: any, message: { isUser: false }) => void) => void;
  onStreamChunk: (callback: (event: any, data: { delta: string }) => void) => void;
  onStreamEnd: (callback: () => void) => void;
  onToolCallRequestFromMain: (callback: (event: any, toolCalls: ToolCall[]) => void) => void;
  onAskUserRequestFromMain: (callback: (event: any, question: string) => void) => void;
  onTerminateRequestFromMain: (callback: (event: any, reason: string) => void) => void;
  onCommandOutputFromMain: (callback: (event: any, output: string) => void) => void;
  onAgentQuestion: (callback: (event: any, data: { question: string; request_id: string }) => void) => void;
  onAgentStepUpdate: (callback: (event: any, data: AgentStepUpdateData) => void) => void;
  onCostUpdate: (callback: (event: any, payload: CostUpdatePayload) => void) => void;
  onTriggerSendMessage: (callback: (event: any) => void) => void;
  onSetSelectedTextContext: (callback: (event: any, content: string) => void) => void;
  onTranscriptionResult: (callback: (event: any, text: string) => void) => void;
  onBackendStatusMessage: (callback: (event: any, data: { statusType: 'error' | 'warning' | 'info', text: string }) => void) => void;
  sendToolResponse: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => void;
  sendUserResponse: (requestId: string, answer: string) => void;
  setLlmModel: (modelName: string) => void;
  sendAudioInput: (audioData: string, format: string) => void;
  sendApiKeys: (keys: { [provider: string]: string }) => void;
}

// Define the interface for the cleanup API
export interface ICleanupAPI {
  removeMessageListener: () => void;
  removeStreamStartListener: () => void;
  removeStreamChunkListener: () => void;
  removeStreamEndListener: () => void;
  removeToolCallRequestListener: () => void;
  removeAskUserRequestListener: () => void;
  removeTerminateRequestListener: () => void;
  removeCommandOutputListener: () => void;
  removeAgentQuestionListener: () => void;
  removeAgentStepUpdateListener: () => void;
  removeCostUpdateListener: () => void;
  removeTriggerSendMessageListener: () => void;
  removeSetSelectedTextContextListener: () => void;
  removeTranscriptionResultListener: () => void;
  removeSendApiKeysListener: () => void;
  removeBackendStatusMessageListener: () => void;
}

// Extend the Window interface
declare global {
  interface Window {
    electronAPI: IElectronAPI;
    cleanup: ICleanupAPI;
  }
} 