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

// Enable more detailed logging
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('[Main] Unhandled Rejection:', error);
});

// Ensure only one instance of the app is running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Another instance is running, quitting...');
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
    console.log('[Main] Current working directory:', process.cwd());
    console.log('[Main] App path:', app.getAppPath());
    console.log('[Main] __dirname:', __dirname);
    
    try {
      // Create the main window
      const window = createWindow();
      console.log('[Main] Window created successfully');
      
      // Connect to the WebSocket server
      connectWebSocket();
      console.log('[Main] WebSocket connection initialized');
      
      // Register IPC handlers
      registerIpcHandlers();
      console.log('[Main] IPC handlers registered');
      
      // Register global shortcuts
      registerGlobalShortcuts();
      console.log('[Main] Global shortcuts registered');
    } catch (error) {
      console.error('[Main] Error during initialization:', error);
    }
  }).catch((error) => {
    console.error('[Main] Error in app.whenReady():', error);
  });

  // Quit when all windows are closed, except on macOS
  app.on('window-all-closed', () => {
    console.log('[Main] All windows closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // On macOS, re-create a window when the dock icon is clicked
  app.on('activate', () => {
    console.log('[Main] App activated');
    if (app.isReady()) {
      createWindow();
    }
  });

  // Unregister shortcuts when quitting
  app.on('will-quit', () => {
    console.log('[Main] App will quit');
    unregisterGlobalShortcuts();
  });

  // Enable source maps in development
  if (process.env.NODE_ENV === 'development') {
    require('source-map-support').install();
  }
} 