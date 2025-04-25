import React, { useRef, useEffect } from 'react';
import './ChatHistory.css';

interface ChatInfo {
  title: string;
  last_active_at: string;
}

interface ChatHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  chatTitles: ChatInfo[];
  onSelectChat: (title: string) => void;
  anchorRef: React.RefObject<HTMLButtonElement>; // Reference to the button that opens the dropdown
}

const formatTimeAgo = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) {
    return 'just now';
  }
  
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  }
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays}d ago`;
  }
  
  const diffInWeeks = Math.floor(diffInDays / 7);
  return `${diffInWeeks}w ago`;
};

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
        chatTitles.map((chat, index) => (
          <div 
            key={index} 
            className="chat-history-item"
            onClick={() => {
              onSelectChat(chat.title);
              onClose();
            }}
          >
            <span className="chat-title">{chat.title}</span>
            <span className="chat-time">{formatTimeAgo(chat.last_active_at)}</span>
          </div>
        ))
      )}
    </div>
  );
};