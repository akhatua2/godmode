import React, { useRef, useEffect, useState, useCallback } from 'react';
import './ChatInput.css'; // Import the CSS
import { PiWaveformBold } from "react-icons/pi";

// Updated Props
interface ChatInputProps {
  inputValue: string;
  isProcessing: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  sessionCost: number;
  contextTexts: string[];
  onRemoveContext: (index: number) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ 
  inputValue, 
  isProcessing, 
  onInputChange, 
  sessionCost,
  contextTexts,
  onRemoveContext,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [includeScreenshot, setIncludeScreenshot] = useState(false); 

  // --- Audio Recording State & Refs --- 
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // --- State and Handler for Model Selection (MOVED FROM APP) --- 
  const modelMap = {
    "gpt-4o-mini": "4o-mini",
    "gpt-4.1-mini": "4.1mini",
    "ollama/llama3.2": "llama3.2",
    "ollama/qwen2.5:7b": "qwen2.5",
    "gemini/gemini-2.0-flash": "gemini2.0",
    "anthropic/claude-3-5-sonnet-20240620": "claude3.5",
    "azure/gpt-4o-mini": "a4o-mini",
  };
  const availableModels = Object.keys(modelMap);
  const [selectedModel, setSelectedModel] = useState<string>(availableModels[0]); // Default to first model
  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = event.target.value;
    console.log(`[ChatInput] Model selected: ${newModel}`);
    setSelectedModel(newModel);
    window.electronAPI.setLlmModel(newModel); // Send update via IPC
  };
  // --- End Model State and Handler --- 

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const maxHeight = 200;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue]);

  // --- Audio Recording Handlers (Moved Up & Revised Logic) --- 
  const startRecording = useCallback(async () => {
    // Prevent starting if already recording (check recorder state) or processing text input
    if (mediaRecorderRef.current?.state === 'recording' || isProcessing) {
      console.log(`[ChatInput] startRecording called but blocked: recorderState=${mediaRecorderRef.current?.state}, isProcessing=${isProcessing}`);
      return;
    }
    try {
      console.log('[ChatInput] Attempting to start recording...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: 'audio/webm;codecs=opus' }; // Specify MIME type
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = []; // Clear previous chunks

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: options.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
          const base64Data = base64String.split(',')[1]; 
          console.log('[ChatInput] Sending audio data...');
          window.electronAPI.sendAudioInput(base64Data, 'webm'); // Send base64 data
        };
        reader.readAsDataURL(audioBlob);
        
        // Clean up tracks
        stream.getTracks().forEach(track => track.stop());
        // --- Set isRecording false ONLY after processing --- 
        // setIsRecording(false); // Reverted: State handled in stopRecording for click
        console.log('[ChatInput] MediaRecorder stopped in onstop.'); // Updated log
      };

      mediaRecorder.start();
      setIsRecording(true);
      console.log('[ChatInput] Recording started');
    } catch (err) {
      console.error('[ChatInput] Error starting recording:', err);
      // Optionally show an error to the user
      setIsRecording(false); // Ensure state is reset on error
    }
  }, [isProcessing]);

  const stopRecording = useCallback(() => {
    // Check recorder state directly
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      console.log('[ChatInput] Explicitly stopping recording via stopRecording()...'); 
      mediaRecorderRef.current.stop(); // Triggers onstop handler
      setIsRecording(false); // Restore immediate state update for click
    } else {
      console.log(`[ChatInput] stopRecording called but no active recording found. State: ${mediaRecorderRef.current?.state}`);
    }
  }, []); 
  // --- End Audio Recording Handlers ---

  // --- Listener for CMD+K Shortcut ---
  useEffect(() => {
    const handleGlobalSend = () => {
      console.log('[ChatInput] CMD+K triggered, calling handleSendMessage');
      handleSendMessage();
    };

    console.log('[ChatInput] Setting up trigger-send-message listener');
    window.electronAPI.onTriggerSendMessage(handleGlobalSend);

    // Cleanup function to remove the listener
    return () => {
      console.log('[ChatInput] Removing trigger-send-message listener');
      window.cleanup?.removeTriggerSendMessageListener();
    };
  }, [inputValue, includeScreenshot, isProcessing]); // Add dependencies of handleSendMessage
  // --- End Listener for CMD+K Shortcut ---

  const handleSendMessage = useCallback(() => {
    // Read context from props
    if (!isProcessing && (inputValue.trim() || contextTexts.length > 0)) { // Allow sending if contextTexts array has items
      console.log(`[ChatInput] Sending message. Include screenshot: ${includeScreenshot}. Contexts: ${contextTexts.length}`);
      
      // Concatenate context texts into a single string
      const concatenatedContext = contextTexts.join('\n\n'); // Join with double newline
      
      // Pass concatenated context string to the main process
      window.electronAPI.sendMessage(inputValue, includeScreenshot, concatenatedContext);
      // Input clearing and context clearing will be handled by App.tsx based on receiving the user message back
    } else {
        // Add a log here to see why it might not be sending
        console.log(`[ChatInput] handleSendMessage called via shortcut/enter, but conditions not met. isProcessing: ${isProcessing}, inputValue empty: ${!inputValue.trim()}`);
    }
  }, [inputValue, includeScreenshot, isProcessing, contextTexts]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Check for Enter without Shift OR Cmd/Ctrl + Enter
    if ((e.key === 'Enter' && !e.shiftKey) || 
        (e.key === 'Enter' && (e.metaKey || e.ctrlKey)))
    {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage();
  };

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-2 border-gray-200">
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden p-2 chat-input-container">
        {/* --- NEW: Wrapper for top row elements --- */}
        <div className="chat-input-top-row">
          {/* Existing Add Context/Screenshot Button */}
          <button
            type="button" // Prevent form submission
            onClick={() => setIncludeScreenshot(!includeScreenshot)}
            disabled={isProcessing}
            className={`toggle-screenshot-button ${includeScreenshot ? 'active' : ''}`}
            title={includeScreenshot ? 'Remove screenshot context' : 'Add screenshot context'}
          >
            {/* Styled '@' symbol */}
            <span>@</span> 
            Add screenshot
          </button>

          {/* Render Selected Text Context Block (if it exists) */}
          {contextTexts.map((text, index) => (
            <div key={index} className="context-display-block">
              <span className="context-text-preview">{text.substring(0, 10)}{text.length > 10 ? '...' : ''}</span>
              <button 
                type="button" 
                onClick={() => onRemoveContext(index)} 
                className="clear-context-button"
                title="Clear context"
              >
                &times; {/* Use HTML entity for 'x' */}
              </button>
            </div>
          ))}
        </div>
        {/* --- End Wrapper --- */}

        {/* --- Input Row with Waveform Placeholder --- */}
        <div className="chat-input-main-row">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              onInputChange(e);
              requestAnimationFrame(adjustTextareaHeight);
            }}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? "Recording... Speak now!" : "Type or record message..."}
            disabled={isProcessing || isRecording} // Disable text input while recording or processing
            rows={1}
            className="chat-input-textarea"
          />
        </div>
        {/* --- End Input Row --- */}

        {/* --- NEW: Wrapper for bottom-right elements --- */}
        <div className="chat-input-bottom-right">
          {/* Waveform Placeholder - Moved Here */}
          <div
            onClick={handleMicClick}
            className={`waveform-placeholder ${isRecording ? 'recording' : ''}`}
            title={isRecording ? 'Stop recording' : 'Start recording'}
            role="button" // Indicate it's clickable
            tabIndex={0} // Make it focusable
            onKeyDown={(e) => { // Allow activation with Enter/Space
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleMicClick();
              }
            }}
          >
            {/* Simple visual bars for the waveform */}
            <PiWaveformBold className={isRecording ? 'glimmering' : ''} />

          </div>

          {/* Session Cost Display (moved inside wrapper) */}
          <div className="session-cost-display">
            Cost: ${sessionCost.toFixed(6)}
          </div>

          {/* Model Selector (moved here) */}
          <select value={selectedModel} onChange={handleModelChange} className="model-selector-select">
            {(Object.keys(modelMap) as Array<keyof typeof modelMap>).map(model => (
              <option key={model} value={model}>{modelMap[model]}</option>
            ))}
          </select>
        </div>
        {/* --- End bottom-right wrapper --- */}
      </div>
    </form>
  );
}; 
