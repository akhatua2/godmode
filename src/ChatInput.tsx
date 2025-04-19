import React, { useRef, useEffect, useState } from 'react';

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
  // State for the screenshot checkbox
  const [includeScreenshot, setIncludeScreenshot] = useState(true); 

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
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Textarea Container */}
        <div className="relative">
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
            className="w-full px-2 pt-0.5 pb-0.5 text-xs text-gray-700 bg-transparent border-none focus:outline-none focus:ring-0 resize-none min-h-[44px] scrollbar-none relative"
          />
        </div>

        {/* Bottom bar with checkbox */}
        <div className="flex items-center justify-end px-2 py-1.5 border-t border-gray-100 text-xs">
          <label htmlFor="screenshot-checkbox" className="flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              id="screenshot-checkbox"
              checked={includeScreenshot}
              onChange={(e) => setIncludeScreenshot(e.target.checked)}
              className="mr-1"
              disabled={isProcessing}
            />
            <span style={{ color: '#ccc' }}>Send Screenshot Context</span>
          </label>
          {/* Submit button could go here if needed, but Enter key works */}
        </div>
      </div>
    </form>
  );
}; 