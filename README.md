# Godmode

<img src="nohup.png" alt="Godmode Logo" width="200"/>

Your AI-powered desktop companion that brings the power of large language models to your fingertips. Built with Electron, React, and TypeScript for a seamless native experience.

## What Can You Do With Godmode?

### 🤖 Natural Language Computing
- Control your computer using plain English commands
- Execute complex terminal operations without remembering syntax
- Automate repetitive tasks through conversation

### 📸 Visual Integration
- Capture and share screenshots directly in your conversations
- Get AI analysis of visual content
- Reference screen elements naturally in your commands

### 🎙️ Voice and Audio
- Speak to your AI assistant naturally
- Transcribe audio files automatically
- Voice command support for hands-free operation

### ⚡ Power Features
- Global shortcuts for instant access from anywhere
- Context-aware responses based on your current work
- Persistent chat history and session management
- Customizable settings and API key management

### 🔧 System Integration
- Seamless integration with your operating system
- File and folder management through natural language
- Application control and automation
- Cross-platform support (macOS, Windows, Linux)

## Getting Started

```bash
# Install dependencies
npm install

# Start the app in development mode
npm start

# Build the app for production
npm run package
```

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
│   └── index.ts          # Preload script entry point
├── tools/                 # Tool execution
│   └── tool-executor.ts   # Tool execution logic
├── types/                 # Type definitions
│   └── index.ts          # Shared type definitions
└── renderer.tsx          # Renderer entry point
```

## License

[MIT](LICENSE) 