import { app, BrowserWindow } from 'electron';
import SquirrelStartup from 'electron-squirrel-startup';

// Import modules
import { createWindow } from './window-manager';
import { connectWebSocket } from './websocket-client';
import { registerIpcHandlers } from './ipc-handlers';
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts';

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (SquirrelStartup) {
  app.quit();
}

// Ensure only one instance of the app is running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      const mainWindow = allWindows[0];
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }
  });

  /**
   * Initialize the application when Electron is ready
   */
  app.whenReady().then(() => {
    console.log('[Main] Electron app is ready');
    
    // Create the main window
    createWindow();
    
    // Connect to the WebSocket server
    connectWebSocket();
    
    // Register IPC handlers
    registerIpcHandlers();
    
    // Register global shortcuts
    registerGlobalShortcuts();
  });

  // Quit when all windows are closed, except on macOS
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // On macOS, re-create a window when the dock icon is clicked
  app.on('activate', () => {
    if (app.isReady()) {
      createWindow();
    }
  });

  // Unregister shortcuts when quitting
  app.on('will-quit', () => {
    unregisterGlobalShortcuts();
  });

  // Enable source maps in development
  // This makes stack traces more readable when using TypeScript
  if (process.env.NODE_ENV === 'development') {
    require('source-map-support').install();
  }
} 