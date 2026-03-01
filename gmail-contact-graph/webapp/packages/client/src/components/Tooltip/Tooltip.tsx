import React from 'react';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';

export function Tooltip() {
  const { state, dispatch } = useAppContext();
  const { selectedNode, domains, messageGroups } = state;

  if (!selectedNode) return null;

  const total = selectedNode.received + selectedNode.sent;
  const sentPercent = total > 0 ? Math.round((selectedNode.sent / total) * 100) : 0;
  const receivedPercent = total > 0 ? Math.round((selectedNode.received / total) * 100) : 0;

  // Find domain info
  const emailDomain = selectedNode.email.split('@')[1]?.toLowerCase();
  const domainUsers = domains?.domain_groups?.[emailDomain];
  const hasDomain = domainUsers && domainUsers.length >= 2;

  // Find message groups
  const contactGroups = messageGroups?.groups
    ? Object.entries(messageGroups.groups)
        .filter(([_, emails]) => emails.includes(selectedNode.email.toLowerCase()))
        .map(([subject, emails]) => ({ subject, count: emails.length }))
    : [];

  const handleClose = () => {
    dispatch({ type: 'SELECT_NODE', payload: null });
  };

  const handleMarkHuman = async () => {
    try {
      await api.markClear(selectedNode.email);
      dispatch({ type: 'MARK_CONTACT_CLEAR', payload: selectedNode.email });
    } catch (err) {
      console.error('Failed to mark contact as clear:', err);
    }
  };

  const handleMarkNotHuman = async () => {
    try {
      await api.markNotHuman(selectedNode.email);
      dispatch({ type: 'REMOVE_CONTACT', payload: selectedNode.email });
      dispatch({ type: 'SELECT_NODE', payload: null });
    } catch (err) {
      console.error('Failed to mark contact as not human:', err);
    }
  };

  return (
    <div className="tooltip visible" style={{ left: 100, top: 100 }}>
      <button className="tooltip-close" onClick={handleClose}>&times;</button>
      <div className="tooltip-name">{selectedNode.name}</div>
      <div className="tooltip-email">{selectedNode.email}</div>

      {hasDomain && (
        <div className="tooltip-org visible">
          @{emailDomain} ({domainUsers.length} contacts)
        </div>
      )}

      {contactGroups.length > 0 && (
        <div className="tooltip-groups visible">
          {contactGroups.map(({ subject, count }) => (
            <div key={subject}>"{subject}" ({count} recipients)</div>
          ))}
        </div>
      )}

      <div className="tooltip-stats">
        <div className="tooltip-stat">
          <span className="tooltip-stat-label">Received</span>
          <span className="tooltip-stat-value received">
            {selectedNode.received.toLocaleString()} ({receivedPercent}%)
          </span>
        </div>
        <div className="tooltip-stat">
          <span className="tooltip-stat-label">Sent</span>
          <span className="tooltip-stat-value sent">
            {selectedNode.sent.toLocaleString()} ({sentPercent}%)
          </span>
        </div>
      </div>

      <div className="tooltip-buttons">
        {selectedNode.notClear && (
          <button className="mark-human-btn" style={{ display: 'block' }} onClick={handleMarkHuman}>
            It's a human
          </button>
        )}
        <button className="mark-not-human-btn" onClick={handleMarkNotHuman}>
          Not a human
        </button>
      </div>
    </div>
  );
}

export default Tooltip;
