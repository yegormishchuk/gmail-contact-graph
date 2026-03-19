import React, { useRef, useLayoutEffect, useState } from 'react';
import type { GroupHoverData } from '../../hooks/useD3Simulation';

const OFFSET = 16;

interface GroupTooltipProps {
  data: GroupHoverData | null;
  position: { x: number; y: number } | null;
}

export function GroupTooltip({ data, position }: GroupTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

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
  }, [position, data]);

  if (!data || !position) return null;

  const total = data.totalSent + data.totalReceived;
  const sentPercent = total > 0 ? Math.round((data.totalSent / total) * 100) : 0;
  const receivedPercent = total > 0 ? Math.round((data.totalReceived / total) * 100) : 0;

  return (
    <div
      ref={ref}
      className="tooltip visible group-tooltip"
      style={{
        left: pos.left,
        top: pos.top,
        pointerEvents: 'none',
        borderColor: data.color + '55',
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px ${data.color}18`,
      }}
    >
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
