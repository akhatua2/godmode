/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

// Add React specific imports and mounting logic
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App'; // Import our main App component from the components directory

console.log('👋 Renderer script loaded'); // Updated log message

// Function to mount the React app
function mountApp() {
  const container = document.getElementById('root');
  if (container) {
    console.log('Found #root element, mounting React app...');
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } else {
    console.error('Failed to find the root element');
  }
}

// Wait for the DOM to be fully loaded before mounting
if (document.readyState === 'loading') { // Loading hasn't finished yet
  document.addEventListener('DOMContentLoaded', mountApp);
} else { // `DOMContentLoaded` has already fired
  mountApp();
}

// Add basic CSS for html/body to support the blur effect
// and ensure the app takes full height.
const style = document.createElement('style');
style.textContent = `
  html, body, #root {
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden; /* Prevent scrollbars from interfering with layout */
  }
  body {
    background-color: transparent; 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
`;
document.head.append(style);
