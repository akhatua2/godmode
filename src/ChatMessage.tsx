import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ToolCall } from './types'; // Import ToolCall type

interface ChatMessageProps {
  text: string;
  isUser: boolean;
  isImage?: boolean;
  isToolRequest?: boolean;
  isCommandOutput?: boolean;
  toolCalls?: ToolCall[];
  onToolResponse?: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => void;
  isResponded: boolean;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ 
    text, 
    isUser, 
    isImage, 
    isToolRequest, 
    isCommandOutput, 
    toolCalls, 
    onToolResponse,
    isResponded
}) => {
  // Determine the CSS class based on the message type
  const messageClass = isUser 
      ? 'message-item message-user' 
      : isToolRequest 
          ? 'message-item message-tool-request' 
          : isCommandOutput
              ? 'message-item message-command-output'
              : 'message-item message-bot';
          
  // State to track if the image is expanded
  const [isExpanded, setIsExpanded] = useState(false);

  // Function to toggle expansion
  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
  };
  
  // Handler for approve/deny buttons
  const handleDecision = (decision: 'approved' | 'denied') => {
      if (onToolResponse && toolCalls && toolCalls.length > 0) {
          const toolCallId = toolCalls[0].id;
          onToolResponse(toolCallId, decision);
      }
  };

  return (
    <div className={messageClass}>
      {
        isImage ? (
          // If it's an image message, render the collapsible structure
          <div className="screenshot-container">
            <div className="screenshot-header" onClick={toggleExpansion}>
              <span className="screenshot-chevron">{isExpanded ? '⌄' : '›'}</span>
              <span className="screenshot-label">Screen Context</span>
            </div>
            {isExpanded && (
              <div className="screenshot-image-wrapper">
                 <img 
                   src={text} 
                   alt="Screenshot" 
                   className="screenshot-image" // Use class for styling
                 />
              </div>
            )}
          </div>
        ) : isToolRequest && toolCalls && toolCalls.length > 0 ? (
            // --- Tool Request Rendering (Terminal Style) ---
            <div className="tool-terminal-container"> 
                {/* Optional: Add a header/title bar if desired */}
                {/* <div className="tool-terminal-header"></div> */}
                <div className="tool-terminal-content">
                  {/* <p className="tool-terminal-prompt">Assistant wants to run:</p> */}
                  <pre className="tool-terminal-command">
                    <code>{JSON.parse(toolCalls[0].function.arguments).command}</code>
                  </pre>
                </div>
                {/* Only show buttons if it has NOT been responded to */} 
                {!isResponded && (
                  <div className="tool-terminal-buttons"> 
                      <button onClick={() => handleDecision('denied')} className="tool-button-cancel">Cancel</button>
                      <button onClick={() => handleDecision('approved')} className="tool-button-ok">Ok</button>
                  </div>
                )}
            </div>
        ) : isCommandOutput ? (
            // --- Render Command Output --- 
            <pre className="command-output-text"><code>{text}</code></pre>
        ) : isUser ? (
          // If it's a user message, render text as usual
          text
        ) : (
          // If it's a bot message (and not an image), render using ReactMarkdown
          <ReactMarkdown>{text}</ReactMarkdown>
        )
      }
    </div>
  );
}; 