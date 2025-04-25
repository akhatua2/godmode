import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css'; // Import CSS
import { ChatInput } from './ChatInput'; // Import the new component
import { ChatMessage } from './ChatMessage'; // Import the new message component
import { Settings } from './Settings'; // Import Settings component
import { Toast } from './Toast'; // Add this importv
import { ChatHistory } from './ChatHistory';

// Import the type definition for cleaner code
import type { Message, ChatMessageProps, ToolCall, AgentStepUpdateData, CostUpdatePayload } from '../types';

// Interface for the pending question state
interface PendingQuestion {
  question: string;
  requestId: string;
}

// Interface for the ChatInfo
interface ChatInfo {
  title: string;
  last_active_at: string;
}

// --- Define providers you want inputs for ---
// const API_KEY_PROVIDERS = ['openai', 'anthropic', 'groq']; // REMOVED from here

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

  // --- State for API Key Inputs --- // REMOVED
  // const [apiKeysInput, setApiKeysInput] = useState<{ [provider: string]: string }>(() => { // REMOVED
  //   // Initialize state with empty strings for each provider // REMOVED
  //   const initialKeys: { [provider: string]: string } = {}; // REMOVED
  //   API_KEY_PROVIDERS.forEach(provider => { // REMOVED
  //     initialKeys[provider] = ''; // REMOVED
  //   }); // REMOVED
  //   return initialKeys; // REMOVED
  // }); // REMOVED
  // const [showApiKeyInputs, setShowApiKeyInputs] = useState(false); // REMOVED State to toggle visibility
  // --- End API Key State --- // REMOVED

  // --- State for Settings Dialog --- // ADDED
  const [isSettingsOpen, setIsSettingsOpen] = useState(false); // ADDED
  const [activeApiKeys, setActiveApiKeys] = useState<{ [provider: string]: string }>({}); // ADDED Store active keys
  // --- End Settings State --- // ADDED

  // Add toast state
  const [toast, setToast] = useState<{message: string; visible: boolean} | null>(null);


  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [chatTitles, setChatTitles] = useState<ChatInfo[]>([]);
  const historyButtonRef = useRef<HTMLButtonElement>(null);


  // Add new function to fetch chat titles
  const fetchChatTitles = async () => {
    try {
      console.log('[App] Fetching chat titles from backend...');
      const response = await fetch('http://localhost:8000/chats');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log('[App] Received chat data:', data);
      
      // Use the chat info objects directly
      const chatInfos = data.chats.map((chat: { title: string; last_active_at: string }) => ({
        title: chat.title || 'Untitled Chat',
        last_active_at: chat.last_active_at
      }));
      console.log('[App] Extracted chat infos:', chatInfos);
      setChatTitles(chatInfos);
    } catch (error) {
      console.error('[App] Failed to fetch chat titles:', error);
      setChatTitles([]); // Set empty array on error
    }
  };
  

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
    // Only set processing to true if it's not an auto-executed tool
    if (decision === 'approved' && !result) {
      setIsProcessing(true);
    }
    window.electronAPI.sendToolResponse(toolCallId, decision, result);
  };

  // Add effect to fetch chat titles when history is opened
  useEffect(() => {
    if (isHistoryOpen) {
      fetchChatTitles();
    }
  }, [isHistoryOpen]);

  // --- Handler for saving keys from Settings component --- // ADDED
  const handleSaveKeysFromSettings = useCallback((keysFromSettings: { [provider: string]: string }) => { // ADDED
    console.log('[App] Saving keys received from Settings:', keysFromSettings); // ADDED
    setActiveApiKeys(keysFromSettings); // Update active keys state // ADDED
    window.electronAPI.sendApiKeys(keysFromSettings); // Send to main process // ADDED
    setIsSettingsOpen(false); // Close the dialog // ADDED
  }, []); // ADDED No dependencies needed here
  // --- End Save Keys from Settings Handler --- // ADDED

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
        setIsProcessing(false); // Treat termination as the end, disable input
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

    // --- Listener for Transcription Result --- 
    const handleTranscriptionResult = (event: Electron.IpcRendererEvent, text: string) => {
      console.log('App: Transcription result received:', text);
      // Append the transcribed text to the current input value
      setInputValue(prev => (prev ? prev + ' ' : '') + text); 
      // Optionally re-focus the input field
      // textareaRef.current?.focus(); // Would need to pass ref to ChatInput
    };
    // --- End Transcription Listener ---

    // --- Listener for Backend Status (Errors/Warnings/Info) --- // ADDED
    const handleBackendStatus = (event: Electron.IpcRendererEvent, { statusType, text }: { statusType: 'error' | 'warning' | 'info', text: string }) => {
        console.log(`App: Backend status [${statusType}]: ${text}`);
        // Add message to UI
        setMessages(prev => [...prev, { text: text, isUser: false }]);
        // Stop processing indicators if it's an error or warning
        if (statusType === 'error' || statusType === 'warning') {
            setIsProcessing(false);
            setIsBotStreaming(false);
        }
    };
    // --- End Backend Status Listener --- // ADDED

    // Add new handler for toast notifications from main process
    const handleToastNotification = (event: Electron.IpcRendererEvent, { text }: { text: string }) => {
      setToast({ message: text, visible: true });
    };

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
    window.electronAPI.onToastNotification(handleToastNotification); // Add this new listener
    // Feature removed: CommandOrControl+I paste
    // window.electronAPI.onPasteFromGlobalShortcut(handleGlobalPaste); // Add listener

    // Add the new listener
    window.electronAPI.onSetSelectedTextContext(handleSetSelectedTextContext);

    // Add the new listener
    window.electronAPI.onTranscriptionResult(handleTranscriptionResult); // Register new listener

    // Add the new listener
    window.electronAPI.onBackendStatusMessage(handleBackendStatus); // ADDED: Register the new listener

    // Cleanup function to remove the listeners when the component unmounts
    return () => {
      // Use the correct exposed API name: cleanup
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

      // Add cleanup for the new listener
      window.cleanup?.removeTranscriptionResultListener(); // Add cleanup for new listener

      // Add cleanup for the new listener
      window.cleanup?.removeBackendStatusMessageListener(); // ADDED: Cleanup the new listener
      
      // Add cleanup for toast notification listener
      window.cleanup?.removeToastNotificationListener();
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

  // --- Handler for starting a new chat ---
  const handleStartNewChat = useCallback(() => {
    console.log('[App] Starting new chat session');
    // Clear UI state
    setMessages([]);
    setInputValue('');
    setSelectedTextContexts([]);
    setRespondedToolCallIds(new Set());
    // Send message to main process to create new chat session
    window.electronAPI.startNewChat();
  }, []);
  // --- End new chat handler ---

  return (
    <div className="app-container">
      {/* Title bar - ONLY this outer div is draggable */}
      <div className="title-bar">
        {/* Container for buttons/controls - NOT draggable */}
        <div className="title-bar-controls">
          <button
            onClick={handleStartNewChat}
            className="new-chat-button"
            title="New Chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button
            ref={historyButtonRef}
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className="history-button"
            title="Chat History"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8v4l3 3"></path>
              <path d="M3.05 11a9 9 0 1 1 .5 4"></path>
            </svg>
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="settings-toggle-button"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          
          {/* Position the ChatHistory component here, right after the buttons */}
          <ChatHistory
            isOpen={isHistoryOpen}
            onClose={() => {
              console.log('[App] Closing chat history dropdown');
              setIsHistoryOpen(false);
            }}
            chatTitles={chatTitles}
            onSelectChat={(title) => {
              console.log('[App] Selected chat title:', title);
              setIsHistoryOpen(false);
              // TODO: Implement chat selection logic
            }}
            anchorRef={historyButtonRef}
          />
        </div>
      </div>

      {/* Settings Component (Dialog/Overlay) */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialKeys={activeApiKeys}
        onSaveKeys={handleSaveKeysFromSettings}
      />

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

      {/* Conditionally render ChatInput and Agent Input based on state */} 
      <>
        <ChatInput 
          inputValue={inputValue}
          onInputChange={handleInputChange}
          isProcessing={isProcessing || isBotStreaming || !!pendingQuestion} 
          sessionCost={currentSessionCost}
          contextTexts={selectedTextContexts}
          onRemoveContext={handleRemoveContext}
        />
        {/* Conditional Input for Agent Question */}
        {pendingQuestion && (
          <div className="agent-question-input-area">
            <form onSubmit={handleAgentAnswerSubmit} className="agent-question-form">
              <input 
                type="text"
                value={agentAnswerInput}
                onChange={(e) => setAgentAnswerInput(e.target.value)}
                placeholder={`Reply to agent...`}
                autoFocus // Focus on the input when it appears
              />
              <button type="submit" className="agent-question-submit-button">Send</button>
            </form>
          </div>
        )}
      </>
      {/* --- End Conditional Rendering --- */}

      {/* Add Toast component */}
      {toast && toast.visible && (
        <Toast 
          message={toast.message} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}

export default App;