import { globalShortcut, clipboard } from 'electron';
import { exec } from 'node:child_process';
import { getMainWindow, isWindowVisibleAndFocused, showAndFocusWindow, hideWindow } from './window-manager';

const SEND_SHORTCUT = 'CommandOrControl+K';
const PASTE_SHORTCUT = 'CommandOrControl+U';
const TOGGLE_SHORTCUT = 'CommandOrControl+B';

/**
 * Registers all global shortcuts
 */
export function registerGlobalShortcuts(): void {
  registerSendMessageShortcut();
  registerPasteShortcut();
  registerToggleWindowShortcut();
}

/**
 * Unregisters all global shortcuts
 */
export function unregisterGlobalShortcuts(): void {
  console.log('[Shortcuts] Unregistering all shortcuts');
  
  // Unregister specific shortcuts
  globalShortcut.unregister(SEND_SHORTCUT);
  globalShortcut.unregister(PASTE_SHORTCUT);
  globalShortcut.unregister(TOGGLE_SHORTCUT);
  
  // Unregister all as a fallback
  globalShortcut.unregisterAll();
}

/**
 * Registers a shortcut to trigger sending a message
 */
function registerSendMessageShortcut(): void {
  const ret = globalShortcut.register(SEND_SHORTCUT, () => {
    console.log(`[Shortcuts] ${SEND_SHORTCUT} pressed.`);
    const mainWindow = getMainWindow();
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[Shortcuts] Sending trigger-send-message');
      mainWindow.webContents.send('trigger-send-message');
    } else {
      console.warn(`[Shortcuts] ${SEND_SHORTCUT} pressed, but mainWindow is not available.`);
    }
  });

  if (!ret) {
    console.error(`[Shortcuts] Registration failed for ${SEND_SHORTCUT}`);
  } else {
    console.log(`[Shortcuts] ${SEND_SHORTCUT} registered successfully`);
  }
}

/**
 * Registers a shortcut to paste selected text into the chat
 */
function registerPasteShortcut(): void {
  const ret = globalShortcut.register(PASTE_SHORTCUT, () => {
    console.log(`[Shortcuts] ${PASTE_SHORTCUT} pressed.`);
    
    if (process.platform === 'darwin') { // macOS specific implementation
      // AppleScript to simulate Cmd+C
      const appleScriptCopy = 'tell application "System Events" to keystroke "c" using command down';
      
      // Use osascript to execute the AppleScript
      exec(`osascript -e '${appleScriptCopy}'`, (error, stdout, stderr) => {
        if (error) {
          console.error(`[Shortcuts] osascript error simulating copy: ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`[Shortcuts] osascript stderr simulating copy: ${stderr}`);
          // Continue anyway, maybe copy still worked
        }
        
        // Introduce a tiny delay to allow the clipboard to update
        setTimeout(() => {
          const mainWindow = getMainWindow();
          
          if (mainWindow && !mainWindow.isDestroyed()) {
            const selectedText = clipboard.readText(); // Read the result of the Cmd+C
            if (selectedText) {
              console.log('[Shortcuts] Sending set-selected-text-context with selected text');
              mainWindow.webContents.send('set-selected-text-context', selectedText);
            } else {
              console.log('[Shortcuts] Clipboard empty after simulated copy, likely no text selected.');
            }
          } else {
            console.warn(`[Shortcuts] ${PASTE_SHORTCUT} - mainWindow not available after copy simulation.`);
          }
        }, 100); // 100ms delay - adjust if needed
      });
    } else { // Fallback for non-macOS (optional - could just do nothing)
      console.warn(`[Shortcuts] ${PASTE_SHORTCUT} - Get selected text only implemented for macOS.`);
    }
  });

  if (!ret) {
    console.error(`[Shortcuts] Registration failed for ${PASTE_SHORTCUT}`);
  } else {
    console.log(`[Shortcuts] ${PASTE_SHORTCUT} registered successfully`);
  }
}

/**
 * Registers a shortcut to toggle the window visibility
 */
function registerToggleWindowShortcut(): void {
  const ret = globalShortcut.register(TOGGLE_SHORTCUT, () => {
    console.log(`[Shortcuts] ${TOGGLE_SHORTCUT} pressed.`);
    
    if (isWindowVisibleAndFocused()) {
      console.log('[Shortcuts] Hiding window.');
      hideWindow();
    } else {
      console.log('[Shortcuts] Showing and focusing window.');
      showAndFocusWindow();
    }
  });

  if (!ret) {
    console.error(`[Shortcuts] Registration failed for ${TOGGLE_SHORTCUT}`);
  } else {
    console.log(`[Shortcuts] ${TOGGLE_SHORTCUT} registered successfully`);
  }
} 