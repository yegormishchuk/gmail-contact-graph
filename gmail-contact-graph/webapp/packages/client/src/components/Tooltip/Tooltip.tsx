import React, { useRef, useLayoutEffect, useState, useCallback, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';
import { graphConfig } from '../../utils/graphConfig';

function formatDurationSec(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const OFFSET = 14;

export function Tooltip() {
  const { state, dispatch } = useAppContext();
  const { selectedNode, selectedNodePosition, domains, messageGroups } = state;
  const isCalendarMode = state.filters.filterType === 'calendar';
  const calendarInfo = isCalendarMode && selectedNode
    ? state.calendarData?.nodes.find(n => n.email.toLowerCase() === selectedNode.email.toLowerCase()) ?? null
    : null;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const [showAllGroups, setShowAllGroups] = useState(false);

  useEffect(() => {
    setShowAllGroups(false);
  }, [selectedNode?.email]);
  const dragState = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);

  useLayoutEffect(() => {
    if (!tooltipRef.current || !selectedNodePosition) return;
    const { x, y } = selectedNodePosition;
    const { offsetWidth: w, offsetHeight: h } = tooltipRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + OFFSET;
    let top = y + OFFSET;

    if (left + w > vw) left = x - w - OFFSET;
    if (top + h > vh) top = y - h - OFFSET;
    if (left < 0) left = 0;
    if (top < 0) top = 0;

    setPos({ left, top });
  }, [selectedNodePosition, selectedNode]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Don't drag when clicking buttons
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pos.left,
      startTop: pos.top,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const w = tooltipRef.current?.offsetWidth ?? 0;
      const h = tooltipRef.current?.offsetHeight ?? 0;
      const left = Math.max(0, Math.min(window.innerWidth - w, dragState.current.startLeft + dx));
      const top = Math.max(0, Math.min(window.innerHeight - h, dragState.current.startTop + dy));
      setPos({ left, top });
    };

    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  if (!selectedNode) return null;

  const total = selectedNode.received + selectedNode.sent;
  const sentPercent = total > 0 ? Math.round((selectedNode.sent / total) * 100) : 0;
  const receivedPercent = total > 0 ? Math.round((selectedNode.received / total) * 100) : 0;

  // Find domain info
  const emailDomain = selectedNode.email.split('@')[1]?.toLowerCase();
  const domainUsers = domains?.domain_groups?.[emailDomain];
  const hasDomain = domainUsers && domainUsers.length >= 2;

  // Find message groups (min 3 members), sorted by member count desc
  const contactGroups = messageGroups?.groups
    ? Object.entries(messageGroups.groups)
        .filter(([_, emails]) =>
          emails.map(e => e.toLowerCase()).includes(selectedNode.email.toLowerCase()) &&
          emails.length >= 3
        )
        .map(([subject, emails]) => ({ subject, count: emails.length }))
        .sort((a, b) => b.count - a.count)
    : [];

  const visibleGroups = showAllGroups ? contactGroups : contactGroups.slice(0, 2);

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
    <div
      ref={tooltipRef}
      className="tooltip visible"
      style={{ left: pos.left, top: pos.top, cursor: 'grab' }}
      onMouseDown={handleDragStart}
    >
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
          {visibleGroups.map(({ subject, count }, i) => (
            <div key={subject} style={{ color: graphConfig.groupColors[i % graphConfig.groupColors.length] }}>
              "{subject}" ({count} recipients)
            </div>
          ))}
          {contactGroups.length > 2 && (
            <button className="show-more-btn" onClick={() => setShowAllGroups(v => !v)}>
              {showAllGroups ? 'Show less' : `+${contactGroups.length - 2} more groups`}
            </button>
          )}
        </div>
      )}

      {isCalendarMode && calendarInfo ? (
        <div className="tooltip-stats">
          <div className="tooltip-stat">
            <span className="tooltip-stat-label">Meetings</span>
            <span className="tooltip-stat-value">{calendarInfo.totalEvents.toLocaleString()}</span>
          </div>
          <div className="tooltip-stat">
            <span className="tooltip-stat-label">Avg duration</span>
            <span className="tooltip-stat-value">{formatDurationSec(calendarInfo.avgDurationSeconds)}</span>
          </div>
          <div className="tooltip-stat">
            <span className="tooltip-stat-label">Avg attendees</span>
            <span className="tooltip-stat-value">
              {calendarInfo.avgAttendees !== null ? calendarInfo.avgAttendees.toFixed(1) : '—'}
            </span>
          </div>
          <div className="tooltip-stat">
            <span className="tooltip-stat-label">Acceptance</span>
            <span className="tooltip-stat-value">
              {calendarInfo.acceptanceRate !== null
                ? `${Math.round(calendarInfo.acceptanceRate * 100)}%`
                : '—'}
            </span>
          </div>
          <div className="tooltip-stat">
            <span className="tooltip-stat-label">Score</span>
            <span className="tooltip-stat-value">{Math.round(calendarInfo.calendarScore).toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <div className="tooltip-stats">
          <div className="tooltip-stat">
            <span className="tooltip-stat-label" style={{ color: '#00a86b' }}>Received</span>
            <span className="tooltip-stat-value" style={{ color: '#00a86b' }}>
              {selectedNode.received.toLocaleString()} ({receivedPercent}%)
            </span>
          </div>
          <div className="tooltip-stat">
            <span className="tooltip-stat-label" style={{ color: graphConfig.sentColor }}>Sent</span>
            <span className="tooltip-stat-value" style={{ color: graphConfig.sentColor }}>
              {selectedNode.sent.toLocaleString()} ({sentPercent}%)
            </span>
          </div>
        </div>
      )}

      {!isCalendarMode && (
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
      )}
    </div>
  );
}

export default Tooltip;
