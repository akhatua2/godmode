# Laptop LLM

A desktop application for interacting with LLMs, built with Electron, React, and TypeScript.

## Project Structure

```
src/
├── components/            # React components
│   ├── App.tsx           
│   ├── App.css
│   ├── ChatInput.tsx
│   ├── ChatInput.css
│   ├── ChatMessage.tsx
│   ├── ChatMessage.css
│   ├── Settings.tsx
│   └── Settings.css
├── main/                  # Main process code
│   ├── index.ts           # Entry point
│   ├── window-manager.ts  # Window creation and management
│   ├── websocket-client.ts# WebSocket connection and message handling
│   ├── ipc-handlers.ts    # IPC event handlers
│   ├── shortcuts.ts       # Global shortcut registration
│   ├── screenshot.ts      # Screenshot functionality
│   └── chat-session.ts    # Chat session management
├── preload/               # Preload script
│   └── index.ts           # Preload script entry point
├── tools/                 # Tool execution
│   └── tool-executor.ts   # Tool execution logic
├── types/                 # Type definitions
│   └── index.ts           # Shared type definitions
└── renderer.tsx           # Renderer entry point
```

## Development

```bash
# Install dependencies
npm install

# Start the app in development mode
npm start

# Build the app for production
npm run package
```

## Features

- Chat with LLMs
- Take screenshots and include in messages
- Execute bash commands through natural language
- Global shortcuts for quick access
- Audio transcription and voice input
- Settings management for API keys

## License

[MIT](LICENSE) 