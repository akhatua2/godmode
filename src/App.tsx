import React, { useState, useEffect, useRef } from 'react';
import './App.css'; // We'll create this CSS file next
import { ChatInput } from './ChatInput'; // Import the new component
import { ChatMessage } from './ChatMessage'; // Import the new message component

// Import the type definition for cleaner code
import type { Message, ChatMessageProps, ToolCall, AgentStepUpdateData, CostUpdatePayload } from './types';

// Interface for the pending question state
interface PendingQuestion {
  question: string;
  requestId: string;
}

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

  // --- New State for Agent Interaction ---
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [agentAnswerInput, setAgentAnswerInput] = useState(''); // Input for agent's question
  // const [isAgentThinking, setIsAgentThinking] = useState(false); // Can use isProcessing for now
  // --- End New State ---

  // --- State for Session Cost --- 
  const [currentSessionCost, setCurrentSessionCost] = useState<number>(0.0);
  // --- End Cost State ---

  // --- State for Selected Text Context --- 
  const [selectedTextContexts, setSelectedTextContexts] = useState<string[]>([]);
  // --- End Context State ---

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
        // Clear the array
        setSelectedTextContexts([]); // Clear context array after sending
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

    // --- Register Agent Listeners --- 
    const handleAgentQuestion = (event: Electron.IpcRendererEvent, data: { question: string; request_id: string }) => {
        console.log('App: Agent question received:', data);
        setIsProcessing(false); // Agent is waiting
        setIsBotStreaming(false);
        // Add the question as a regular bot message
        setMessages(prev => [...prev, { text: data.question, isUser: false }]);
        // Set the pending question state to show the input
        setPendingQuestion({ question: data.question, requestId: data.request_id });
    };
    
    const handleAgentStepUpdate = (event: Electron.IpcRendererEvent, data: AgentStepUpdateData) => {
        console.log('App: Agent step update received:', data);
        // Add a new message with the update data
        setMessages(prev => [
            ...prev,
            {
                text: "Agent Update", // Placeholder, not shown
                isUser: false,
                isAgentUpdate: true,
                agentUpdateData: data
            }
        ]);
        // Keep processing indicator active while agent is working
        setIsProcessing(true);
    };
    // --- End Agent Listeners --- 

    // --- Register Cost Listener --- 
    const handleCostUpdate = (event: Electron.IpcRendererEvent, payload: CostUpdatePayload) => {
        console.log('App: Cost update received:', payload);
        setCurrentSessionCost(payload.total_cost); 
    };
    // --- End Cost Listener --- 

    // --- Listener for Selected Text Context ---
    const handleSetSelectedTextContext = (event: Electron.IpcRendererEvent, content: string) => {
        console.log('App: Selected text context received:', content.substring(0, 100), '...');
        // Append to array instead of replacing
        setSelectedTextContexts(prev => [...prev, content]);
        // Optionally, you might want to clear the main input value when context is added
        // setInputValue(''); 
    };
    // --- End Context Listener ---

    // Set up the listeners using the exposed API
    // Feature removed: CommandOrControl+I paste
    // const handleGlobalPaste = (event: Electron.IpcRendererEvent, content: string) => {
      // console.log("[App] Received paste via global shortcut.");
      // setInputValue(prev => prev + content); // Append pasted content
      // Optionally, focus the textarea after paste
      // chatInputRef.current?.focus(); // Requires passing a ref to ChatInput
    // };

    window.electronAPI.onMessageFromMain(handleNewMessage);
    window.electronAPI.onStreamStart(handleStreamStart);
    window.electronAPI.onStreamChunk(handleStreamChunk);
    window.electronAPI.onStreamEnd(handleStreamEnd);
    window.electronAPI.onToolCallRequestFromMain(handleToolCallRequest); // run_bash_command
    window.electronAPI.onAskUserRequestFromMain(handleAskUserRequest); // ask_user
    window.electronAPI.onTerminateRequestFromMain(handleTerminateRequest); // terminate
    window.electronAPI.onCommandOutputFromMain(handleCommandOutput); // command output
    window.electronAPI.onAgentQuestion(handleAgentQuestion); // agent_question
    window.electronAPI.onAgentStepUpdate(handleAgentStepUpdate); // agent_step_update
    window.electronAPI.onCostUpdate(handleCostUpdate);
    // Feature removed: CommandOrControl+I paste
    // window.electronAPI.onPasteFromGlobalShortcut(handleGlobalPaste); // Add listener

    // Add the new listener
    window.electronAPI.onSetSelectedTextContext(handleSetSelectedTextContext);

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
      // --- Cleanup new agent listeners --- 
      window.cleanup?.removeAgentQuestionListener();
      window.cleanup?.removeAgentStepUpdateListener();
      // --- End Cleanup ---
      window.cleanup?.removeCostUpdateListener();
      // Feature removed: CommandOrControl+I paste
      // window.cleanup?.removePasteFromGlobalShortcutListener(); // Add cleanup

      // Add cleanup for the new listener
      window.cleanup?.removeSetSelectedTextContextListener();
    };
  }, []); // Empty dependency array means this runs once on mount

  // --- Handler for submitting response to agent's question --- 
  const handleAgentAnswerSubmit = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault(); // Prevent default form submission if used
    if (!pendingQuestion || !agentAnswerInput.trim()) return;

    console.log(`[App] Sending user response for request_id: ${pendingQuestion.requestId}`);

    // Send the response back via IPC
    window.electronAPI.sendUserResponse(pendingQuestion.requestId, agentAnswerInput);

    // Optionally add user's response to chat history for clarity
    setMessages(prev => [
        ...prev, 
        { text: agentAnswerInput, isUser: true, isAgentResponse: true } // Add a flag
    ]);

    // Clear the pending question state and the input field
    setPendingQuestion(null);
    setAgentAnswerInput('');
    setIsProcessing(true); // Assume backend will process immediately
  };
  // --- End Handler ---

  // --- Function to clear selected text context ---
  const handleRemoveContext = (indexToRemove: number) => {
    setSelectedTextContexts(prev => prev.filter((_, index) => index !== indexToRemove));
  };
  // --- End Clear/Remove Context Function ---

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
              isResponded: isResponded,
              // --- Pass agent update data --- 
              isAgentUpdate: msg.isAgentUpdate,
              agentUpdateData: msg.agentUpdateData
              // --- End Pass --- 
          };
          
          return (
            <ChatMessage key={index} {...chatMessageProps} />
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* --- Typing Indicator Container (Now above ChatInput) --- */}
      {isProcessing && (
        <div className="typing-indicator-container">
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
      {/* --- End Typing Indicator --- */}

      <ChatInput 
        inputValue={inputValue}
        onInputChange={handleInputChange}
        // Disable main input if processing OR if waiting for user response to agent
        isProcessing={isProcessing || isBotStreaming || !!pendingQuestion} 
        sessionCost={currentSessionCost}
        // Pass context array and remove function down
        contextTexts={selectedTextContexts}
        onRemoveContext={handleRemoveContext}
      />
      {/* --- Conditional Input for Agent Question --- */}
      {pendingQuestion && (
        <div className="agent-question-input-area">
          <form onSubmit={handleAgentAnswerSubmit} className="agent-question-form">
            <input 
              type="text"
              value={agentAnswerInput}
              onChange={(e) => setAgentAnswerInput(e.target.value)}
              placeholder={`Reply to agent...`}
              className="agent-question-input"
              autoFocus // Focus on the input when it appears
            />
            <button type="submit" className="agent-question-submit-button">Send</button>
          </form>
        </div>
      )}
      {/* --- End Conditional Input --- */}
    </div>
  );
}

export default App; 