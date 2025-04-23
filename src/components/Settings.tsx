import React, { useState, useEffect } from 'react';
import './Settings.css'; // We'll create this CSS file

// Define providers you want inputs for
const API_KEY_PROVIDERS = ['openai', 'anthropic', 'groq']; // Example providers

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialKeys: { [provider: string]: string };
  onSaveKeys: (keys: { [provider: string]: string }) => void;
}

export function Settings({ isOpen, onClose, initialKeys, onSaveKeys }: SettingsProps) {
  const [localApiKeys, setLocalApiKeys] = useState<{ [provider: string]: string }>({});

  // Initialize local state when the dialog opens or initialKeys change
  useEffect(() => {
    if (isOpen) {
        // Initialize with initialKeys, ensuring all providers have an entry
        const initialisedState: { [provider: string]: string } = {};
        API_KEY_PROVIDERS.forEach(provider => {
            initialisedState[provider] = initialKeys[provider] || '';
        });
        setLocalApiKeys(initialisedState);
    }
  }, [isOpen, initialKeys]);

  const handleInputChange = (provider: string, value: string) => {
    setLocalApiKeys(prev => ({ ...prev, [provider]: value }));
  };

  const handleSave = () => {
    // Filter out empty keys before saving
    const keysToSave: { [provider: string]: string } = {};
    for (const provider in localApiKeys) {
      if (localApiKeys[provider].trim() !== '') {
        keysToSave[provider] = localApiKeys[provider].trim();
      }
    }
    onSaveKeys(keysToSave);
    // onClose(); // The parent component will call onClose after saving if needed
  };

  if (!isOpen) {
    return null; // Don't render anything if closed
  }

  return (
    <div className="settings-overlay" onClick={onClose}> {/* Close on overlay click */}
      <div className="settings-dialog" onClick={e => e.stopPropagation()}> {/* Prevent closing when clicking inside dialog */}
        <h2>API Keys</h2>
        <p>These keys will only be used for the current session.</p>
        {API_KEY_PROVIDERS.map(provider => (
          <div key={provider} className="settings-input-group">
            <label htmlFor={`api-key-${provider}`}>{provider.toUpperCase()}</label>
            <input
              type="password"
              id={`api-key-${provider}`}
              value={localApiKeys[provider] || ''} // Ensure value is controlled
              onChange={(e) => handleInputChange(provider, e.target.value)}
              placeholder={`Enter ${provider} API Key`}
            />
          </div>
        ))}
        <div className="settings-buttons">
            <button onClick={handleSave} className="settings-save-button">Save</button>
            <button onClick={onClose} className="settings-close-button">Close</button>
        </div>
      </div>
    </div>
  );
} 