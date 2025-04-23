import React, { useRef, useEffect } from 'react';
import './ChatHistory.css';

interface ChatHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitles: string[];
  onSelectChat: (title: string) => void;
  anchorRef: React.RefObject<HTMLButtonElement>; // Reference to the button that opens the dropdown
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({
  isOpen,
  onClose,
  chatTitles,
  onSelectChat,
  anchorRef,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target as Node) &&
        !anchorRef.current?.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="chat-history-dropdown" ref={dropdownRef}>
      {chatTitles.length === 0 ? (
        <div className="no-chats">No recent chats</div>
      ) : (
        chatTitles.map((title, index) => (
          <div 
            key={index} 
            className="chat-history-item"
            onClick={() => {
              onSelectChat(title);
              onClose();
            }}
          >
            {title}
          </div>
        ))
      )}
    </div>
  );
};