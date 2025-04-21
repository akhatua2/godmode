import React, { useRef, useEffect, useState, useCallback } from 'react';
import './ChatInput.css'; // Import the CSS

// Updated Props
interface ChatInputProps {
  inputValue: string;
  isProcessing: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  sessionCost: number; // Add sessionCost prop
  // onSubmit?: () => void; // No longer needed as submit goes via IPC
  contextTexts: string[];
  onRemoveContext: (index: number) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({ 
  inputValue, 
  isProcessing, 
  onInputChange, 
  sessionCost, // Destructure the prop
  contextTexts,
  onRemoveContext,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // State for the screenshot toggle, default to false
  const [includeScreenshot, setIncludeScreenshot] = useState(false); 

  // --- Audio Recording State & Refs --- 
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // --- End Audio Recording State --- 

  // --- State and Handler for Model Selection (MOVED FROM APP) --- 
  const modelMap = {
    "gpt-4o-mini": "4o-mini",
    "gpt-4.1-mini": "4.1mini",
    "ollama/llama3.2": "llama3.2",
    "ollama/qwen2.5:7b": "qwen2.5",
    "gemini/gemini-2.0-flash": "gemini2.0",
    "anthropic/claude-3-5-sonnet-20240620": "claude3.5"
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
      window.cleanup.removeTriggerSendMessageListener();
    };
    // IMPORTANT: We pass handleSendMessage in the dependency array.
    // If handleSendMessage relies on props/state (like inputValue, includeScreenshot, isProcessing),
    // those should ALSO be in the dependency array or handleSendMessage should be memoized
    // using useCallback in the component definition.
    // For simplicity here, we assume handleSendMessage captures the latest state correctly
    // when called, but this could cause stale closure issues if not careful.
    // Let's add its dependencies to be safe.
  }, [inputValue, includeScreenshot, isProcessing]); // Add dependencies of handleSendMessage
  // --- End Listener for CMD+K Shortcut ---

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

  // --- Audio Recording Handlers --- 
  const startRecording = async () => {
    try {
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
      };

      mediaRecorder.start();
      setIsRecording(true);
      console.log('[ChatInput] Recording started');
    } catch (err) {
      console.error('[ChatInput] Error starting recording:', err);
      // Optionally show an error to the user
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      console.log('[ChatInput] Recording stopped');
    }
  };

  const handleMicClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };
  // --- End Audio Recording Handlers --- 

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

        {/* --- Input Row with Microphone Button --- */}
        <div className="chat-input-main-row">
          {/* Microphone Button - Placed on the left */}
          <button
            type="button"
            onClick={handleMicClick}
            disabled={isProcessing && !isRecording} // Allow stopping recording even if processing text
            className={`mic-button ${isRecording ? 'recording' : ''}`}
            title={isRecording ? 'Stop recording' : 'Start recording'}
          >
             🎙️ {/* Microphone Emoji - Replace with SVG if desired */} 
          </button>

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
