// src/electron.d.ts
// This tells TypeScript about the properties we are adding to the window object
// using the contextBridge in preload.ts

import { IpcRendererEvent } from 'electron';
import type { Message, ToolCall, AgentStepUpdateData, CostUpdatePayload } from './types';

export interface IElectronAPI {
  onPasteFromGlobalShortcut: (callback: (event: IpcRendererEvent, content: string) => void) => void;
  sendMessage: (text: string, includeScreenshot: boolean) => void;
  onMessageFromMain: (callback: (event: IpcRendererEvent, message: Message) => void) => void;
  onStreamStart: (callback: (event: IpcRendererEvent, message: { isUser: false }) => void) => void;
  onStreamChunk: (callback: (event: IpcRendererEvent, data: { delta: string }) => void) => void;
  onStreamEnd: (callback: () => void) => void;
  onToolCallRequestFromMain: (callback: (event: IpcRendererEvent, toolCalls: ToolCall[]) => void) => void;
  onAskUserRequestFromMain: (callback: (event: IpcRendererEvent, question: string) => void) => void;
  onTerminateRequestFromMain: (callback: (event: IpcRendererEvent, reason: string) => void) => void;
  onCommandOutputFromMain: (callback: (event: IpcRendererEvent, output: string) => void) => void;
  onAgentQuestion: (callback: (event: IpcRendererEvent, data: { question: string; request_id: string }) => void) => void;
  onAgentStepUpdate: (callback: (event: IpcRendererEvent, data: AgentStepUpdateData) => void) => void;
  sendToolResponse: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => void;
  sendUserResponse: (requestId: string, answer: string) => void;
  onCostUpdate: (callback: (event: IpcRendererEvent, payload: CostUpdatePayload) => void) => void;
  sendAudioInput: (audioData: string, format: string) => void;
  onTranscriptionResult: (callback: (event: IpcRendererEvent, text: string) => void) => void;
  sendApiKeys: (keys: { [provider: string]: string }) => void;
  onBackendStatusMessage: (callback: (event: IpcRendererEvent, data: { statusType: 'error' | 'warning' | 'info', text: string }) => void) => void;
}

export interface ICleanupAPI {
  removePasteFromGlobalShortcutListener: () => void;
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
  removeTranscriptionResultListener: () => void;
  removeSendApiKeysListener?: () => void;
  removeBackendStatusMessageListener?: () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
    cleanup: ICleanupAPI;
  }
} 