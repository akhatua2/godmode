import React, { useRef, useEffect, useState } from 'react';
import './ChatInput.css'; // Import the CSS

// Updated Props
interface ChatInputProps {
  inputValue: string;
  isProcessing: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  // onSubmit?: () => void; // No longer needed as submit goes via IPC
}

export const ChatInput: React.FC<ChatInputProps> = ({ 
  inputValue, 
  isProcessing, 
  onInputChange 
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // State for the screenshot toggle, default to false
  const [includeScreenshot, setIncludeScreenshot] = useState(false); 

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

  const handleSendMessage = () => {
    if (!isProcessing && inputValue.trim()) {
      console.log(`[ChatInput] Sending message. Include screenshot: ${includeScreenshot}`);
      // Call the new sendMessage function via preload
      window.electronAPI.sendMessage(inputValue, includeScreenshot);
      // Input clearing etc. will be handled by App.tsx based on receiving the user message back
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage();
  };

  return (
    <form onSubmit={handleSubmit} className="p-2 border-gray-200">
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden p-2 chat-input-container">
        {/* New Add Context Button */}
        <button
          type="button" // Prevent form submission
          onClick={() => setIncludeScreenshot(!includeScreenshot)}
          disabled={isProcessing}
          className={`add-context-button ${includeScreenshot ? 'active' : ''}`}
          title={includeScreenshot ? 'Remove screenshot context' : 'Add screenshot context'}
        >
          {/* Styled '@' symbol */}
          <span>@</span> 
          Add screenshot
        </button>

        {/* Textarea Container - Removed old camera button */}
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => {
            onInputChange(e);
            requestAnimationFrame(adjustTextareaHeight);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isProcessing}
          rows={1}
          className="chat-input-textarea" // Use class from CSS (padding handled by CSS)
        />
        {/* Removed the bottom bar with checkbox */}
      </div>
    </form>
  );
}; 