import React from 'react';
import { useAppContext } from '../../context/AppContext';

const MIN_GROUP_SIZE = 3;

export function StatsPage() {
  const { state } = useAppContext();
  const { rawData, domains, messageGroups, excludedContacts } = state;

  if (!rawData || !rawData.stats || !domains || !messageGroups) return null;

  const { stats } = rawData;
  const contacts = rawData.nodes.filter(n => !n.isCenter);

  // Panel 1
  const totalExchanged = stats.totalReceived + stats.totalSent;
  const sentReceivedRatio = stats.totalReceived === 0
    ? '—'
    : (stats.totalSent / stats.totalReceived).toFixed(2);
  const displayedCount = contacts.length;

  // Panel 2
  const twoWay = contacts.filter(n => n.received > 0 && n.sent > 0).length;
  const onlyReceived = contacts.filter(n => n.received > 0 && n.sent === 0).length;
  const noReply = contacts.filter(n => n.sent > 0 && n.received === 0).length;
  const avgEmails = contacts.length === 0
    ? '—'
    : (totalExchanged / contacts.length).toFixed(1);
  const topByReceived = contacts.reduce((best, n) => n.received > (best?.received ?? -1) ? n : best, contacts[0]);
  const topBySent = contacts.reduce((best, n) => n.sent > (best?.sent ?? -1) ? n : best, contacts[0]);

  return (
    <div className="stats-page">
      <div className="stats-grid">

        {/* Panel 1 — Overview */}
        <div className="stat-panel">
          <div className="stat-panel-title">Overview</div>
          <div className="stat-cells">
            <div className="stat-cell">
              <span className="stat-cell-label">Total contacts</span>
              <span className="stat-cell-value">{stats.totalContacts.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Displayed</span>
              <span className="stat-cell-value">{displayedCount.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Emails received</span>
              <span className="stat-cell-value">{stats.totalReceived.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Emails sent</span>
              <span className="stat-cell-value">{stats.totalSent.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Total exchanged</span>
              <span className="stat-cell-value">{totalExchanged.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Sent / received</span>
              <span className="stat-cell-value">{sentReceivedRatio}</span>
            </div>
          </div>
        </div>

        {/* Panel 2 — Contact Patterns */}
        <div className="stat-panel">
          <div className="stat-panel-title">Contact Patterns</div>
          <div className="stat-cells">
            <div className="stat-cell">
              <span className="stat-cell-label">Two-way</span>
              <span className="stat-cell-value">{twoWay.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Only received</span>
              <span className="stat-cell-value">{onlyReceived.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">No reply</span>
              <span className="stat-cell-value">{noReply.toLocaleString()}</span>
              <span className="stat-cell-sub">you emailed, no reply</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Avg emails / contact</span>
              <span className="stat-cell-value">{avgEmails}</span>
            </div>
            {topByReceived && (
              <div className="stat-cell">
                <span className="stat-cell-label">Top by received</span>
                <span className="stat-cell-value">{topByReceived.received.toLocaleString()}</span>
                <span className="stat-cell-sub">{topByReceived.name}</span>
              </div>
            )}
            {topBySent && (
              <div className="stat-cell">
                <span className="stat-cell-label">Top by sent</span>
                <span className="stat-cell-value">{topBySent.sent.toLocaleString()}</span>
                <span className="stat-cell-sub">{topBySent.name}</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
