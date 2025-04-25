import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ToolCall, AgentStepUpdateData } from '../types'; // Import ToolCall type and AgentStepUpdateData from types directory
import './ChatMessage.css'; // Import the CSS file

// --- Helper Function to Extract Minimal Status ---
function extractMinimalStatus(thoughts: string | undefined): string | null {
    if (!thoughts) return null;

    // 1. Extract content within memory='...'
    const memoryMatch = thoughts.match(/memory='([^\']*)'/);
    let memoryContent = memoryMatch ? memoryMatch[1] : null;

    if (!memoryContent) return null; // No memory content found

    // 2. Remove "At step x/y. " prefix
    memoryContent = memoryContent.replace(/^At step \d+\/\d+\.\s*/, '');

    return memoryContent.trim() || null; // Return trimmed content or null if empty
}

// Add this helper function near the other helper functions
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy text: ', err);
    return false;
  }
};

const CheckIcon = () => (
  <svg 
    width="16" 
    height="16" 
    viewBox="0 0 16 16" 
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);

const CopyIcon = ({ isCopied }: { isCopied: boolean }) => (
  isCopied ? <CheckIcon /> : (
    <svg 
      width="16" 
      height="16" 
      viewBox="0 0 16 16" 
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4.5 2.5H12.5V10.5H4.5V2.5Z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2.5 5.5V13.5H10.5V10.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
);
// --- End Helper Function ---

interface ChatMessageProps {
  text: string;
  isUser: boolean;
  isImage?: boolean;
  isToolRequest?: boolean;
  isCommandOutput?: boolean;
  toolCalls?: ToolCall[];
  onToolResponse?: (toolCallId: string, decision: 'approved' | 'denied', result?: string) => void;
  isResponded: boolean;
  isAgentUpdate?: boolean;
  isAgentResponse?: boolean;
  agentUpdateData?: AgentStepUpdateData;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ 
    text, 
    isUser, 
    isImage, 
    isToolRequest, 
    isCommandOutput, 
    toolCalls, 
    onToolResponse,
    isResponded,
    isAgentUpdate,
    isAgentResponse,
    agentUpdateData
}) => {
  // Determine the CSS class based on the message type
  const messageClass = isUser 
      ? 'message-item message-user' 
      : isToolRequest 
          ? 'message-item message-tool-request' 
          : isCommandOutput
              ? 'message-item message-command-output'
              : isAgentUpdate
                  ? 'message-item message-agent-update'
              : 'message-item message-bot';
          
  // State to track if the image is expanded
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCopyFeedback, setShowCopyFeedback] = useState(false);

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

  // Add copy handler
  const handleCopy = async () => {
    const success = await copyToClipboard(text);
    if (success) {
      setShowCopyFeedback(true);
      setTimeout(() => setShowCopyFeedback(false), 2000);
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
                
                {/* Display based on tool type */} 
                {toolCalls[0].function.name === 'run_bash_command' && (
                    <div className="tool-terminal-content">
                        <pre className="tool-terminal-command">
                            <code>{JSON.parse(toolCalls[0].function.arguments).command}</code>
                        </pre>
                    </div>
                )}
                {toolCalls[0].function.name === 'read_file' && (
                     <div className="tool-terminal-content">
                        <p className="tool-file-op-label">Read File:</p>
                        <pre className="tool-terminal-command tool-file-path">
                            <code>{JSON.parse(toolCalls[0].function.arguments).file_path}</code>
                        </pre>
                    </div>
                )}
                {toolCalls[0].function.name === 'edit_file' && (() => {
                    const args = JSON.parse(toolCalls[0].function.arguments);
                    const stringToReplace = args.string_to_replace;
                    const newString = args.new_string;
                    // Truncate for display if needed
                    const replaceToShow = stringToReplace.length > 100 ? stringToReplace.substring(0, 100) + '...' : stringToReplace;
                    const newToShow = newString.length > 100 ? newString.substring(0, 100) + '...' : newString;

                    return (
                        <div className="tool-terminal-content">
                            <p className="tool-file-op-label">Edit File:</p>
                            <div className="git-diff-line git-diff-removed"> {/* Wrapper for filename */} 
                                <pre className="tool-terminal-command git-diff-filename">
                                    {/* Display filename without diff style */}
                                    <code>{args.file_path}</code>
                                </pre>
                            </div>
                            <p className="tool-file-op-label">Replace:</p>
                            <div className="git-diff-line git-diff-removed">
                                <pre className="tool-terminal-command git-diff-content">
                                    {/* Show the string to be replaced */}
                                    <code><span className="git-diff-prefix">-</span> {replaceToShow}</code>
                                </pre>
                            </div>
                            <p className="tool-file-op-label">With:</p>
                            <div className="git-diff-line git-diff-added"> {/* Wrapper for content */} 
                                <pre className="tool-terminal-command git-diff-content">
                                    {/* Show the new string */}
                                    <code><span className="git-diff-prefix">+</span> {newToShow}</code>
                                </pre>
                            </div>
                        </div>
                    );
                })()}

                <div className="tool-terminal-content">
                  {/* <p className="tool-terminal-prompt">Assistant wants to run:</p> */}
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
        ) : isAgentUpdate && agentUpdateData ? (
           // --- Render Minimal Agent Status --- 
           (() => {
               const status = extractMinimalStatus(agentUpdateData.thoughts);
               return status ? (
                   <pre className="agent-status-text"><code>{status}</code></pre>
               ) : null; // Render nothing if status can't be extracted
           })()
        ) : (
          <div className="message-content">
            <ReactMarkdown>{text}</ReactMarkdown>
            {!isAgentUpdate && !isToolRequest && !isCommandOutput && (
              <div className="message-footer">
                <button 
                  className="copy-button"
                  onClick={handleCopy}
                  title="Copy message"
                >
                  <CopyIcon isCopied={showCopyFeedback} />
                </button>
              </div>
            )}
          </div>
        )
      }
    </div>
  );
}; 