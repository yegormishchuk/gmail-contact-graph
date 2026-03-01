import React, { useState } from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  contactName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ isOpen, contactName, onConfirm, onCancel }: ConfirmModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (dontShowAgain) {
      localStorage.setItem('skipDeleteConfirmation', 'true');
    }
    onConfirm();
  };

  return (
    <div className="confirm-modal" onClick={onCancel}>
      <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-title">Remove Contact</div>
        <div className="confirm-modal-text">
          Are you sure you want to mark <strong>{contactName}</strong> as spam?
        </div>
        <label className="confirm-modal-checkbox">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>Don't show again</span>
        </label>
        <div className="confirm-modal-buttons">
          <button className="confirm-modal-btn cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm-modal-btn confirm" onClick={handleConfirm}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
