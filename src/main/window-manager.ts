import { BrowserWindow, screen, app } from 'electron';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

/**
 * Creates the main application window
 */
export function createWindow(): BrowserWindow {
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true, // Temporarily enable for child_process (use with caution, consider sandboxing)
    },
  });

  // Make window visible on all workspaces
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  console.log('[WindowManager] Set window to be visible on all workspaces.');

  mainWindow.setBackgroundColor('#00000000');

  // Load the index.html of the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

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