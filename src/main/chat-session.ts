import { v4 as uuidv4 } from 'uuid';
import { getMainWindow } from './window-manager';
import type { ToolCall } from '../types';

// Store pending tool calls 
const pendingToolCalls = new Map<string, ToolCall>();

// Current chat ID
let currentChatId: string = uuidv4();

// Function references to avoid circular dependency
let connectWebSocketFn: () => void;
let closeWebSocketFn: () => void;

/**
 * Register WebSocket functions to avoid circular dependency
 */
export function registerWebSocketFunctions(
  connectFn: () => void,
  closeFn: () => void
): void {
  connectWebSocketFn = connectFn;
  closeWebSocketFn = closeFn;
}

/**
 * Gets the current chat ID
 */
export function getCurrentChatId(): string {
  return currentChatId;
}

/**
 * Gets a pending tool call by ID
 */
export function getPendingToolCall(toolCallId: string): ToolCall | undefined {
  return pendingToolCalls.get(toolCallId);
}

/**
 * Adds a tool call to the pending map
 */
export function addPendingToolCall(toolCall: ToolCall): void {
  if (toolCall.id) {
    pendingToolCalls.set(toolCall.id, toolCall);
    console.log(`[ChatSession] Stored pending tool call: ${toolCall.id}`);
  }
}

/**
 * Removes a tool call from the pending map
 */
export function removePendingToolCall(toolCallId: string): void {
  pendingToolCalls.delete(toolCallId);
}

/**
 * Clears all pending tool calls
 */
export function clearPendingToolCalls(): void {
  pendingToolCalls.clear();
}

/**
 * Creates a new chat session with a new ID
 */
export function createNewChatSession(): void {
  // Generate new chat ID
  currentChatId = uuidv4();
  console.log(`[ChatSession] Generated new chat ID: ${currentChatId}`);
  
  // Close existing WebSocket connection
  if (closeWebSocketFn) closeWebSocketFn();
  
  // Clear pending tool calls
  clearPendingToolCalls();
  
  // Reconnect with new chat ID
  if (connectWebSocketFn) connectWebSocketFn();
  
  // Notify renderer about the new session using a toast notification
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('toast-notification', { 
      text: 'Started a new chat session'
    });
  }
}