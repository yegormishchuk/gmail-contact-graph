import React, { useRef, useLayoutEffect, useState, useCallback, useEffect, useMemo } from 'react';
import { useAppContext, editsLockedReason } from '../../context/AppContext';
import { api } from '../../api/client';
import { graphConfig } from '../../utils/graphConfig';
import { getSelectedGroups, supportsIsolation, ranksGroups, showsGroupColor, type SelectedGroup } from '../../utils/selectedGroups';
import { useFilteredGraphData } from '../../hooks/useFilteredGraphData';
import { useIsMobile } from '../../hooks/useIsMobile';

function formatDurationSec(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const OFFSET = 14;
/** Groups the graph doesn't draw until isolated. */
const HIDDEN_ROW_COLOR = '#8a8f98';

export function Tooltip() {
  const { state, dispatch } = useAppContext();
  const lockedReason = editsLockedReason(state);
  const locked = lockedReason !== null;
  const { selectedNode, selectedNodePosition, domains, messageGroups, eventGroups, isolatedGroupId } = state;
  const isCalendarMode = state.filters.filterType === 'calendar' || state.filters.filterType === 'eventGroups';
  const isOverallMode = state.filters.filterType === 'overall';
  const calendarInfo = (isCalendarMode || isOverallMode) && selectedNode
    ? state.calendarData?.nodes.find(n => n.email.toLowerCase() === selectedNode.email.toLowerCase()) ?? null
    : null;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const [showAllGroups, setShowAllGroups] = useState(false);
  const isMobile = useIsMobile();
  // Rank against the nodes the graph draws, so the panel and graph agree on
  // which groups are drawn and in what colour.
  const filteredData = useFilteredGraphData();
  const visibleEmails = useMemo(
    () => new Set(filteredData?.nodes.map(n => n.email.toLowerCase()) ?? []),
    [filteredData],
  );

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
  // On a phone an open panel covers the details; closing it brings them back.
  if (isMobile && state.mobilePanel) return null;

  const total = selectedNode.received + selectedNode.sent;
  const sentPercent = total > 0 ? Math.round((selectedNode.sent / total) * 100) : 0;
  const receivedPercent = total > 0 ? Math.round((selectedNode.received / total) * 100) : 0;

  // The graph reads this same list, so clicking a row isolates exactly the
  // connection drawn for it — including its colour.
  const allGroups = getSelectedGroups({
    email: selectedNode.email,
    domains,
    messageGroups,
    eventGroups,
    filterType: state.filters.filterType,
    visibleEmails,
  });

  const canIsolate = supportsIsolation(state.filters.filterType);
  const domainGroup = allGroups.find(g => g.kind === 'domain') ?? null;
  const contactGroups = allGroups.filter(g => g.kind === 'message');
  const eventContactGroups = allGroups.filter(g => g.kind === 'event');

  // Collapsed lists show the two largest groups — plus the isolated one, so
  // collapsing the list can never hide the row that turns isolation back off.
  const collapse = (groups: SelectedGroup[]) => {
    if (showAllGroups) return groups;
    const head = groups.slice(0, 2);
    const active = groups.find(g => g.id === isolatedGroupId);
    return active && !head.includes(active) ? [...head, active] : head;
  };

  const visibleGroups = collapse(contactGroups);
  const visibleEventGroups = collapse(eventContactGroups);

  // Overall and gmail show one ranked list: the drawn groups (and the org,
  // whose borders stay on the graph) always, the rest behind "+N more".
  const ranked = ranksGroups(state.filters.filterType);
  const shownGroups = allGroups.filter(g => g.drawn || g.kind === 'domain');
  const hiddenGroups = allGroups.filter(g => !g.drawn && g.kind !== 'domain');
  const isolatedHidden = hiddenGroups.find(g => g.id === isolatedGroupId);
  const listedHidden = showAllGroups ? hiddenGroups : isolatedHidden ? [isolatedHidden] : [];

  const rowText = (g: SelectedGroup) =>
    g.kind === 'domain' ? `${g.label} (${g.count} contacts)`
      : g.kind === 'message' ? `"${g.label}" (${g.count} recipients)`
        : `"${g.label}" (${g.count} attendees)`;

  const handleClose = () => {
    dispatch({ type: 'SELECT_NODE', payload: null });
  };

  const handleIsolate = (id: string) => {
    dispatch({ type: 'ISOLATE_GROUP', payload: id });
  };

  // One row in the groups list: click to show only this group's connections,
  // click again to bring the rest back. Cluster modes draw no such connections,
  // so there the row stays a plain label.
  const groupRow = (group: SelectedGroup, text: string) => {
    if (!canIsolate) {
      return (
        <div key={group.id} className="group-row-static" style={{ color: group.color }}>
          {text}
        </div>
      );
    }
    const active = isolatedGroupId === group.id;
    const muted = isolatedGroupId !== null && !active;
    return (
      <button
        key={group.id}
        type="button"
        className={`group-row${active ? ' group-row-active' : ''}`}
        style={{ color: showsGroupColor(group, active) ? group.color : HIDDEN_ROW_COLOR, opacity: muted ? 0.45 : 1 }}
        aria-pressed={active}
        title={active ? 'Show all connections again' : `Show only ${group.label}`}
        onClick={() => handleIsolate(group.id)}
      >
        {text}
      </button>
    );
  };

  const handleMarkHuman = async () => {
    if (locked) return;
    try {
      await api.markClear(selectedNode.email);
      dispatch({ type: 'MARK_CONTACT_CLEAR', payload: selectedNode.email });
    } catch (err) {
      console.error('Failed to mark contact as clear:', err);
    }
  };

  const handleMarkNotHuman = async () => {
    if (locked) return;
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
      // On a phone: a sheet along the bottom, not placed by the click or dragged.
      className={`tooltip visible ${isMobile ? 'tooltip-sheet' : ''}`}
      style={isMobile ? undefined : { left: pos.left, top: pos.top, cursor: 'grab' }}
      onMouseDown={isMobile ? undefined : handleDragStart}
    >
      <button className="tooltip-close" onClick={handleClose}>&times;</button>
      <div className="tooltip-name">{selectedNode.name}</div>
      <div className="tooltip-email">{selectedNode.email}</div>

      {ranked ? (
        allGroups.length > 0 && (
          <div className="tooltip-groups visible">
            {shownGroups.map(group => groupRow(group, rowText(group)))}
            {listedHidden.map(group => groupRow(group, rowText(group)))}
            {hiddenGroups.length > 0 && (showAllGroups || listedHidden.length < hiddenGroups.length) && (
              <button className="show-more-btn" onClick={() => setShowAllGroups(v => !v)}>
                {showAllGroups ? 'Show less' : `+${hiddenGroups.length - listedHidden.length} more groups`}
              </button>
            )}
          </div>
        )
      ) : (
        <>
          {domainGroup && (
            <div className="tooltip-org visible">
              {groupRow(domainGroup, `${domainGroup.label} (${domainGroup.count} contacts)`)}
            </div>
          )}

          {contactGroups.length > 0 && (
            <div className="tooltip-groups visible">
              {visibleGroups.map(group => groupRow(group, `"${group.label}" (${group.count} recipients)`))}
              {(showAllGroups ? contactGroups.length > 2 : visibleGroups.length < contactGroups.length) && (
                <button className="show-more-btn" onClick={() => setShowAllGroups(v => !v)}>
                  {showAllGroups ? 'Show less' : `+${contactGroups.length - visibleGroups.length} more groups`}
                </button>
              )}
            </div>
          )}

          {eventContactGroups.length > 0 && (
            <div className="tooltip-groups visible">
              {visibleEventGroups.map(group => groupRow(group, `"${group.label}" (${group.count} attendees)`))}
              {(showAllGroups ? eventContactGroups.length > 2 : visibleEventGroups.length < eventContactGroups.length) && (
                <button className="show-more-btn" onClick={() => setShowAllGroups(v => !v)}>
                  {showAllGroups ? 'Show less' : `+${eventContactGroups.length - visibleEventGroups.length} more events`}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {isOverallMode && (
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
          {calendarInfo && (
            <>
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
            </>
          )}
          <div className="tooltip-stat">
            <span className="tooltip-stat-label">Overall score</span>
            <span className="tooltip-stat-value">{Math.round(selectedNode.compositeScore).toLocaleString()}</span>
          </div>
        </div>
      )}

      {!isOverallMode && (isCalendarMode && calendarInfo ? (
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
      ))}

      {!isCalendarMode && (
        <div className="tooltip-buttons">
          {selectedNode.notClear && (
            <button
              className="mark-human-btn"
              style={{ display: 'block' }}
              onClick={handleMarkHuman}
              disabled={locked}
              title={lockedReason ?? undefined}
            >
              It's a human
            </button>
          )}
          <button
            className="mark-not-human-btn"
            onClick={handleMarkNotHuman}
            disabled={locked}
            title={lockedReason ?? undefined}
          >
            Not a human
          </button>
        </div>
      )}
    </div>
  );
}

export default Tooltip;
