import React, { useEffect, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';
import type { SpamStats } from '@gmail-graph/shared';

const MIN_GROUP_SIZE = 3;

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function StatsPage() {
  const { state } = useAppContext();
  const { rawData, domains, messageGroups, calendarStats } = state;

  const [spamStats, setSpamStats] = useState<SpamStats | null>(null);

  useEffect(() => {
    api.getSpamStats().then(setSpamStats).catch(() => {});
  }, []);

  if (!rawData || !rawData.stats || !domains || !messageGroups) return null;

  const { stats } = rawData;
  const contacts = rawData.nodes.filter(n => !n.isCenter);

  // Panel 1
  const totalExchanged = stats.totalReceived + stats.totalSent;
  const sentReceivedRatio = stats.totalReceived === 0
    ? '—'
    : (stats.totalSent / stats.totalReceived).toFixed(2);
  const displayedCount = contacts.length;

  // Panel 2 — Top Contacts
  const avgEmails = contacts.length === 0
    ? '—'
    : (contacts.reduce((s, n) => s + n.received + n.sent, 0) / contacts.length).toFixed(1);
  const topByReceived = contacts.reduce<typeof contacts[0] | null>((best, n) => best === null || n.received > best.received ? n : best, null);
  const topBySent = contacts.reduce<typeof contacts[0] | null>((best, n) => best === null || n.sent > best.sent ? n : best, null);

  // Panel 3 — Organizations
  const domainEntries = Object.entries(domains.domain_groups);
  const top5Domains = [...domainEntries]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  const topByVolume = domainEntries.reduce<{ domain: string; total: number } | null>((best, [domain, users]) => {
    const vol = users.reduce((s, u) => s + u.total, 0);
    return best === null || vol > best.total ? { domain, total: vol } : best;
  }, null);

  // Panel 4 — Message Groups
  const groupEntries = Object.entries(messageGroups.groups);
  const largestGroup = groupEntries.reduce<{ subject: string; count: number } | null>((best, [subject, members]) => {
    return best === null || members.length > best.count ? { subject, count: members.length } : best;
  }, null);
  const qualifyingGroups = groupEntries.filter(([, members]) => members.length >= MIN_GROUP_SIZE);
  const avgGroupSize = qualifyingGroups.length === 0
    ? '—'
    : (qualifyingGroups.reduce((s, [, m]) => s + m.length, 0) / qualifyingGroups.length).toFixed(1);

  // Panel 5 — Spam
  const excludedCount = spamStats?.excludedCount ?? 0;
  const excludedTotal = spamStats?.excludedTotal ?? 0;
  const allTraffic = totalExchanged + excludedTotal;
  const spamPercent = allTraffic === 0 || spamStats === null
    ? '—'
    : ((excludedTotal / allTraffic) * 100).toFixed(1);

  return (
    <div className="stats-page">
      <div className="stats-grid">

        {/* Panel 1 — Overview */}
        <div className="stat-panel">
          <div className="stat-panel-title">Overview</div>
          <div className="stat-panel-subtitle">non-spam contacts only</div>
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
            <div className="stat-cell">
              <span className="stat-cell-label">Total meetings</span>
              <span className="stat-cell-value">{(calendarStats?.totalMeetings ?? 0).toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Meeting contacts</span>
              <span className="stat-cell-value">{(calendarStats?.uniqueAttendees ?? 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Panel 2 — Top Contacts */}
        <div className="stat-panel">
          <div className="stat-panel-title">Top Contacts</div>
          <div className="stat-panel-subtitle">non-spam contacts only</div>
          <div className="stat-cells">
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
            {calendarStats?.topByScore && (
              <div className="stat-cell">
                <span className="stat-cell-label">Top by calendar score</span>
                <span className="stat-cell-value">{Math.round(calendarStats.topByScore.score).toLocaleString()}</span>
                <span className="stat-cell-sub">{calendarStats.topByScore.name}</span>
              </div>
            )}
            {calendarStats?.topByMeetings && (
              <div className="stat-cell">
                <span className="stat-cell-label">Top by meetings</span>
                <span className="stat-cell-value">{calendarStats.topByMeetings.meetings.toLocaleString()}</span>
                <span className="stat-cell-sub">{calendarStats.topByMeetings.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Panel 3 — Organizations */}
        <div className="stat-panel">
          <div className="stat-panel-title">Organizations</div>
          <div className="stat-cells">
            <div className="stat-cell">
              <span className="stat-cell-label">Unique domains</span>
              <span className="stat-cell-value">{domains.total_domains.toLocaleString()}</span>
            </div>
            {topByVolume && (
              <div className="stat-cell">
                <span className="stat-cell-label">Top by volume</span>
                <span className="stat-cell-value">{topByVolume.total.toLocaleString()}</span>
                <span className="stat-cell-sub">@{topByVolume.domain}</span>
              </div>
            )}
            {calendarStats?.topOrgByMeetings && (
              <div className="stat-cell">
                <span className="stat-cell-label">Top org by meetings</span>
                <span className="stat-cell-value">{calendarStats.topOrgByMeetings.meetings.toLocaleString()}</span>
                <span className="stat-cell-sub">@{calendarStats.topOrgByMeetings.domain}</span>
              </div>
            )}
          </div>
          {top5Domains.length > 0 && (
            <div className="stat-domain-list" style={{ marginTop: '20px' }}>
              <div className="stat-cell-label" style={{ marginBottom: '8px' }}>Top domains by contacts</div>
              {top5Domains.map(([domain, users]) => (
                <div key={domain} className="stat-domain-item">
                  <span className="stat-domain-name">@{domain}</span>
                  <span className="stat-domain-count">{users.length} contacts</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel 4 — Message Groups */}
        <div className="stat-panel">
          <div className="stat-panel-title">Message Groups</div>
          <div className="stat-cells">
            <div className="stat-cell">
              <span className="stat-cell-label">Total groups</span>
              <span className="stat-cell-value">{messageGroups.total_groups.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Avg size (3+ members)</span>
              <span className="stat-cell-value">{avgGroupSize}</span>
            </div>
            {largestGroup && (
              <div className="stat-cell" style={{ gridColumn: '1 / -1' }}>
                <span className="stat-cell-label">Largest group</span>
                <span className="stat-cell-value">{largestGroup.count} members</span>
                <span className="stat-cell-sub" style={{ wordBreak: 'break-word' }}>{largestGroup.subject}</span>
              </div>
            )}
          </div>
        </div>

        {/* Panel — Calendar */}
        <div className="stat-panel">
          <div className="stat-panel-title">Calendar</div>
          <div className="stat-cells">
            <div className="stat-cell">
              <span className="stat-cell-label">Total meetings</span>
              <span className="stat-cell-value">{(calendarStats?.totalMeetings ?? 0).toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Unique meeting contacts</span>
              <span className="stat-cell-value">{(calendarStats?.uniqueAttendees ?? 0).toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Avg meeting duration</span>
              <span className="stat-cell-value">{formatDuration(calendarStats?.avgMeetingDurationSeconds ?? 0)}</span>
            </div>
            {calendarStats?.topByScore && (
              <div className="stat-cell">
                <span className="stat-cell-label">Top by calendar score</span>
                <span className="stat-cell-value">{Math.round(calendarStats.topByScore.score).toLocaleString()}</span>
                <span className="stat-cell-sub">{calendarStats.topByScore.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Panel 5 — Spam (hero) */}
        <div className="stat-panel spam-panel">
          <div className="stat-panel-title">Spam & Excluded</div>
          <div className="stat-cells">
            <div className="stat-cell">
              <span className="stat-cell-label">Excluded contacts</span>
              <span className="stat-cell-value spam-value">{excludedCount.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">Emails from excluded</span>
              <span className="stat-cell-value spam-value">{excludedTotal.toLocaleString()}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-cell-label">% of all traffic</span>
              <span className="stat-cell-value spam-value">{spamPercent}{spamPercent !== '—' ? '%' : ''}</span>
            </div>
          </div>
          <div className="spam-tagline">contacts filtered from your graph</div>
        </div>

      </div>
    </div>
  );
}
