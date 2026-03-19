import React, { useRef, useLayoutEffect, useState, useCallback } from 'react';
import type { GroupHoverData } from '../../utils/groupTypes';

const OFFSET = 16;

interface GroupTooltipProps {
  data: GroupHoverData | null;
  position: { x: number; y: number } | null;
  pinned?: boolean;
  onClose?: () => void;
}

export function GroupTooltip({ data, position, pinned, onClose }: GroupTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const dragState = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);

  useLayoutEffect(() => {
    if (!ref.current || !position || !data) return;
    const { x, y } = position;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + OFFSET;
    let top = y + OFFSET;

    if (left + w > vw) left = x - w - OFFSET;
    if (top + h > vh) top = y - h - OFFSET;
    if (left < 0) left = 0;
    if (top < 0) top = 0;

    setPos({ left, top });
  }, [position?.x, position?.y, data?.label]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!pinned) return;
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
      const w = ref.current?.offsetWidth ?? 0;
      const h = ref.current?.offsetHeight ?? 0;
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
  }, [pinned, pos]);

  if (!data || !position) return null;

  const total = data.totalSent + data.totalReceived;
  const sentPercent = total > 0 ? Math.round((data.totalSent / total) * 100) : 0;
  const receivedPercent = total > 0 ? Math.round((data.totalReceived / total) * 100) : 0;

  return (
    <div
      ref={ref}
      className={`tooltip visible group-tooltip${pinned ? ' group-tooltip-pinned' : ''}`}
      style={{
        left: pos.left,
        top: pos.top,
        pointerEvents: pinned ? 'auto' : 'none',
        cursor: pinned ? 'grab' : 'default',
        borderColor: data.color + '55',
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px ${data.color}18`,
      }}
      onMouseDown={pinned ? handleDragStart : undefined}
    >
      {pinned && (
        <button className="tooltip-close" onClick={onClose}>&times;</button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: data.color, flexShrink: 0 }} />
        <div className="tooltip-name" style={{ margin: 0 }}>{data.label}</div>
      </div>

      <div className="tooltip-email" style={{ marginBottom: 12 }}>
        {data.memberCount} contacts &middot;&nbsp;
        {data.orgCount} organization{data.orgCount !== 1 ? 's' : ''}
      </div>

      <div className="tooltip-stats">
        <div className="tooltip-stat">
          <span className="tooltip-stat-label" style={{ color: '#00a86b' }}>Received</span>
          <span className="tooltip-stat-value" style={{ color: '#00a86b' }}>
            {data.totalReceived.toLocaleString()} ({receivedPercent}%)
          </span>
        </div>
        <div className="tooltip-stat">
          <span className="tooltip-stat-label" style={{ color: '#86efac' }}>Sent</span>
          <span className="tooltip-stat-value" style={{ color: '#86efac' }}>
            {data.totalSent.toLocaleString()} ({sentPercent}%)
          </span>
        </div>
      </div>
    </div>
  );
}

export default GroupTooltip;
