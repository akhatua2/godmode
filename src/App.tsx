import React, { useState, useEffect, useRef } from 'react';
import './App.css'; // We'll create this CSS file next
import { ChatInput } from './ChatInput'; // Import the new component
import { ChatMessage } from './ChatMessage'; // Import the new message component

// Import the type definition for cleaner code
import type { Message, ChatMessageProps, ToolCall } from './types';

function App() {
  // Update state to hold an array of Message objects
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  // isProcessing now indicates if *any* backend activity is happening (screenshot or LLM call)
  const [isProcessing, setIsProcessing] = useState(false);
  // New state to track if the bot response is currently streaming
  const [isBotStreaming, setIsBotStreaming] = useState(false);
  // --- State to track responded tool calls ---
  const [respondedToolCallIds, setRespondedToolCallIds] = useState<Set<string>>(new Set());
  // Ref to scroll to bottom
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages]); // Scroll whenever messages update

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setInputValue(event.target.value);
  };

  // --- Handler for sending tool response back to main --- 
  const handleToolResponse = (toolCallId: string, decision: 'approved' | 'denied', result?: string) => {
    console.log(`[App] User ${decision} tool call: ${toolCallId}`);
    setRespondedToolCallIds(prevSet => new Set(prevSet).add(toolCallId));
    setIsProcessing(decision === 'approved'); 
    window.electronAPI.sendToolResponse(toolCallId, decision, result);
  };

  // Effect to listen for messages and stream events from the main process
  useEffect(() => {
    // Handles complete messages (user message, image, errors, connection status)
    const handleNewMessage = (event: Electron.IpcRendererEvent, message: Message) => {
      console.log('App: Message received from main:', message);
      setMessages(prev => [...prev, message]);
      
      // If it was a user message, clear input and set processing state.
      if (message.isUser) {
        setInputValue(''); 
        setIsProcessing(true); // Start processing (screenshot + LLM)
      }
      // If it's an error message or connection message, stop processing.
      if (!message.isUser && (message.text.startsWith('[Error') || message.text.startsWith('[Backend Error') || message.text.startsWith('[WebSocket Error') || message.text.startsWith('[Connection lost'))) {
          setIsProcessing(false);
          setIsBotStreaming(false); // Ensure streaming stops on error
      }
      // Screenshot messages don't stop processing, as LLM call follows
    };

    // Handles the start of a bot response stream
    const handleStreamStart = (event: Electron.IpcRendererEvent, message: { isUser: false }) => {
      console.log('App: Stream start');
      setIsBotStreaming(true);
      setIsProcessing(true); // Ensure processing is true during stream
      // Add an empty message placeholder for the bot response
      setMessages(prev => [...prev, { text: '', isUser: false, isImage: false }]);
    };

    // Handles incoming chunks of the bot response stream
    const handleStreamChunk = (event: Electron.IpcRendererEvent, data: { delta: string }) => {
      // console.log('App: Stream chunk:', data.delta); // Can be noisy
      if (!data || typeof data.delta !== 'string') return;
      setMessages(prev => {
          // Make sure there's at least one message
          if (prev.length === 0) return prev; 
          // Get the last message
          const lastMessage = prev[prev.length - 1];
          // Make sure it's a non-user, non-image message (the one we are streaming to)
          if (!lastMessage || lastMessage.isUser || lastMessage.isImage || lastMessage.isToolRequest) return prev; 
          // Create a new array with the updated last message
          return [
              ...prev.slice(0, -1), // All messages except the last one
              { ...lastMessage, text: lastMessage.text + data.delta } // Updated last message
          ];
      });
    };

    // Handles the end of the bot response stream
    const handleStreamEnd = () => {
      console.log('App: Stream end');
      setIsBotStreaming(false);
      setIsProcessing(false); // Streaming is finished, stop processing indicator
    };

    // Listener for tool call requests (run_bash_command)
    const handleToolCallRequest = (event: Electron.IpcRendererEvent, toolCalls: ToolCall[]) => {
        console.log('App: Tool call request received:', toolCalls);
        setIsProcessing(true); // Keep processing while waiting for user approval
        setIsBotStreaming(false); // Ensure normal streaming stops
        // Add a new message object representing the tool request
        setMessages(prev => [
            ...prev, 
            {
                text: "Tool execution required", // Placeholder text, not really shown now
                isUser: false,
                isToolRequest: true,
                toolCalls: toolCalls // Store the actual tool call details
            }
        ]);
    };
    
    // --- New Listeners for ask_user and terminate --- 
    const handleAskUserRequest = (event: Electron.IpcRendererEvent, question: string) => {
        console.log('App: Ask user request received:', question);
        setIsProcessing(false); // Agent is waiting for user, stop processing indicator
        setIsBotStreaming(false);
        // Add the question as a regular bot message
        setMessages(prev => [...prev, { text: question, isUser: false }]);
    };
    
    const handleTerminateRequest = (event: Electron.IpcRendererEvent, reason: string) => {
        console.log('App: Terminate request received:', reason);
        setIsProcessing(true); // Treat termination as the end, disable input
        setIsBotStreaming(false);
        // Add the reason as a regular bot message
        setMessages(prev => [...prev, { text: reason || "Task finished.", isUser: false }]);
    };
    // --- End New Listeners ---

    // --- Listener for direct command output --- 
    const handleCommandOutput = (event: Electron.IpcRendererEvent, output: string) => {
        // Add log to check if this is being called
        console.log('App: <<< Command output received via IPC >>>:', output.substring(0, 100), '...'); 
        setMessages(prev => [...prev, { text: output, isUser: false, isCommandOutput: true }]);
    };
    // --- End command output listener ---

    // Set up the listeners using the exposed API
    window.electronAPI.onMessageFromMain(handleNewMessage);
    window.electronAPI.onStreamStart(handleStreamStart);
    window.electronAPI.onStreamChunk(handleStreamChunk);
    window.electronAPI.onStreamEnd(handleStreamEnd);
    window.electronAPI.onToolCallRequestFromMain(handleToolCallRequest); // run_bash_command
    window.electronAPI.onAskUserRequestFromMain(handleAskUserRequest); // ask_user
    window.electronAPI.onTerminateRequestFromMain(handleTerminateRequest); // terminate
    window.electronAPI.onCommandOutputFromMain(handleCommandOutput); // command output

    // Cleanup function to remove the listeners when the component unmounts
    return () => {
      // Assume these cleanup functions will be exposed via preload
      window.cleanup?.removeMessageListener();
      window.cleanup?.removeStreamStartListener();
      window.cleanup?.removeStreamChunkListener();
      window.cleanup?.removeStreamEndListener();
      window.cleanup?.removeToolCallRequestListener(); 
      window.cleanup?.removeAskUserRequestListener(); 
      window.cleanup?.removeTerminateRequestListener(); 
      window.cleanup?.removeCommandOutputListener(); // Add cleanup
    };
  }, []); // Empty dependency array means this runs once on mount

  return (
    <div className="app-container">
      {/* Empty div for dragging */}
      <div className="title-bar"></div>
      <div className="messages-area">
        {messages.map((msg, index) => {
          // Determine if this specific tool request has been responded to
          const toolCallId = (msg.isToolRequest && msg.toolCalls && msg.toolCalls.length > 0) ? msg.toolCalls[0].id : null;
          const isResponded = toolCallId ? respondedToolCallIds.has(toolCallId) : false;
          
          // Prepare props for ChatMessage
          const chatMessageProps: ChatMessageProps = {
              text: msg.text,
              isUser: msg.isUser,
              isImage: msg.isImage,
              isToolRequest: msg.isToolRequest,
              isCommandOutput: msg.isCommandOutput,
              toolCalls: msg.toolCalls,
              onToolResponse: handleToolResponse,
              isResponded: isResponded
          };
          
          return (
            <ChatMessage key={index} {...chatMessageProps} />
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput 
        inputValue={inputValue}
        onInputChange={handleInputChange}
        isProcessing={isProcessing || isBotStreaming} 
      />
    </div>
  );
}

export default App; 