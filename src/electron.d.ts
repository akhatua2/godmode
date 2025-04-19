// src/electron.d.ts
// This tells TypeScript about the properties we are adding to the window object
// using the contextBridge in preload.ts

export interface IElectronAPI {
  sendMessageWithScreenshot: (text: string) => void;
  onMessageFromMain: (callback: (event: Electron.IpcRendererEvent, ...args: any[]) => void) => void;
}

export interface ICleanupAPI {
  removeMessageListener: () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
    cleanup: ICleanupAPI;
  }
} 