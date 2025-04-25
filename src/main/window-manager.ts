import { BrowserWindow, screen, app } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

/**
 * Creates the main application window
 */
export function createWindow(): BrowserWindow {
  console.log('[WindowManager] Creating window with __dirname:', __dirname);
  
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      // In production, __dirname is inside .vite/build
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
  });

  // Make window visible on all workspaces
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  console.log('[WindowManager] Set window to be visible on all workspaces.');
  console.log('[WindowManager] Preload path:', path.join(__dirname, 'preload.js'));

  mainWindow.setBackgroundColor('#00000000');

  // Add error handler
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[WindowManager] Failed to load:', errorCode, errorDescription);
  });

  // Add console logging from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  // Load the index.html of the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    console.log('[WindowManager] Loading dev URL:', MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    const htmlPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    console.log('[WindowManager] Loading production path:', htmlPath);
    mainWindow.loadFile(htmlPath);
  }

  // Always open DevTools for debugging
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Returns the current main window instance
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Shows and focuses the main window
 */
export function showAndFocusWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

/**
 * Hides the main window
 */
export function hideWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

/**
 * Returns whether the main window is visible and focused
 */
export function isWindowVisibleAndFocused(): boolean {
  return !!(mainWindow && mainWindow.isVisible() && mainWindow.isFocused());
}

/**
 * Returns the primary display for the system
 */
export function getPrimaryDisplay() {
  return screen.getPrimaryDisplay();
} 