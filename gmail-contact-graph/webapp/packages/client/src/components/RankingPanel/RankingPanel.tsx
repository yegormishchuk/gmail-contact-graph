import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';
import { graphConfig } from '../../utils/graphConfig';
import type { GraphNode } from '@gmail-graph/shared';
import type { GroupHoverData } from '../../utils/groupTypes';

const MIN_GROUP_SIZE = 3;

interface GroupRankItem {
  label: string;
  totalScore: number;
  memberCount: number;
  color: string;
}

export function RankingPanel() {
  const { state, dispatch } = useAppContext();
  const [searchQuery, setSearchQuery] = useState('');

  const { rawData, excludedContacts, rankingTab, panelVisible } = state;
  const filterType = state.filters.filterType;
  const isGroupFilter = filterType === 'messageGroups' || filterType === 'organizations';
  const isContactFilter = filterType === 'moreReceived' || filterType === 'moreSent';
  const hasFilter = filterType !== null;

  // Auto-switch to 'filtered' tab when a filter becomes active, back to 'ranking' when cleared
  useEffect(() => {
    if (filterType !== null) {
      dispatch({ type: 'SET_RANKING_TAB', payload: 'filtered' });
    } else {
      dispatch({ type: 'SET_RANKING_TAB', payload: 'ranking' });
    }
  }, [filterType]);

  if (!panelVisible) {
    return (
      <button
        className="ranking-show-btn"
        title="Show ranking"
        onClick={() => dispatch({ type: 'TOGGLE_PANEL' })}
      >
        ☰
      </button>
    );
  }

  // Get contacts sorted by composite score
  const contacts = rawData?.nodes
    .filter(n => !n.isCenter)
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .filter(n => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return n.name.toLowerCase().includes(query) || n.email.toLowerCase().includes(query);
    }) || [];

  // Filter ranking — contacts
  const filteredContacts: GraphNode[] = isContactFilter
    ? (rawData?.nodes
        .filter(n => !n.isCenter)
        .filter(n => filterType === 'moreReceived' ? n.received > n.sent : n.sent > n.received)
        .sort((a, b) => b.compositeScore - a.compositeScore)
        .filter(n => {
          if (!searchQuery) return true;
          const q = searchQuery.toLowerCase();
          return n.name.toLowerCase().includes(q) || n.email.toLowerCase().includes(q);
        }) ?? [])
    : [];

  // Filter ranking — groups
  const groupRanking: GroupRankItem[] = (() => {
    if (!isGroupFilter || !rawData) return [];
    const nodesByEmail = new Map(
      rawData.nodes.filter(n => !n.isCenter).map(n => [n.email.toLowerCase(), n])
    );
    const items: GroupRankItem[] = [];

    if (filterType === 'messageGroups' && state.messageGroups) {
      Object.entries(state.messageGroups.groups).forEach(([subject, emails]) => {
        const members = emails
          .map(e => nodesByEmail.get(e.toLowerCase()))
          .filter((n): n is GraphNode => n !== undefined);
        if (members.length >= MIN_GROUP_SIZE) {
          items.push({
            label: subject,
            totalScore: members.reduce((sum, m) => sum + m.compositeScore, 0),
            memberCount: members.length,
            color: '',
          });
        }
      });
    } else if (filterType === 'organizations' && state.domains) {
      Object.entries(state.domains.domain_groups).forEach(([domain, users]) => {
        const members = users
          .map(u => nodesByEmail.get(u.email.toLowerCase()))
          .filter((n): n is GraphNode => n !== undefined);
        if (members.length >= MIN_GROUP_SIZE) {
          items.push({
            label: `@${domain}`,
            totalScore: members.reduce((sum, m) => sum + m.compositeScore, 0),
            memberCount: members.length,
            color: '',
          });
        }
      });
    }

    items.sort((a, b) => b.totalScore - a.totalScore);

    // Assign colors from graphConfig palette
    items.forEach((item, i) => {
      item.color = graphConfig.groupColors[i % graphConfig.groupColors.length];
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return items.filter(g => g.label.toLowerCase().includes(q));
    }
    return items;
  })();

  const handleTabChange = (tab: 'ranking' | 'filtered' | 'spam') => {
    dispatch({ type: 'SET_RANKING_TAB', payload: tab });
  };

  const handleContactClick = (contact: GraphNode, e: React.MouseEvent) => {
    const focusGraphNode = (window as any).focusGraphNode as
      | ((email: string, onFound: (pos: { x: number; y: number }) => void, onNotFound?: () => void) => void)
      | undefined;

    if (focusGraphNode) {
      focusGraphNode(
        contact.email,
        (screenPos) => {
          dispatch({ type: 'SELECT_NODE', payload: contact, position: screenPos });
        },
        () => {
          dispatch({ type: 'SELECT_NODE', payload: contact, position: { x: e.clientX, y: e.clientY } });
        },
      );
    } else {
      dispatch({ type: 'SELECT_NODE', payload: contact, position: { x: e.clientX, y: e.clientY } });
    }
  };

  const handleGroupClick = (group: GroupRankItem, e: React.MouseEvent) => {
    const focusGroupFn = (window as any).focusGroup as
      | ((label: string, onFound: (pos: { x: number; y: number }) => void, onNotFound?: () => void) => void)
      | undefined;

    const data: GroupHoverData = {
      label: group.label,
      memberCount: group.memberCount,
      totalSent: 0,
      totalReceived: 0,
      orgCount: 0,
      color: group.color,
    };

    // Compute full stats from rawData
    if (rawData) {
      const nodesByEmail = new Map(
        rawData.nodes.filter(n => !n.isCenter).map(n => [n.email.toLowerCase(), n])
      );
      if (filterType === 'messageGroups' && state.messageGroups) {
        const emails = state.messageGroups.groups[group.label] ?? [];
        const members = emails.map(e2 => nodesByEmail.get(e2.toLowerCase())).filter((n): n is GraphNode => n !== undefined);
        data.totalSent = members.reduce((s, m) => s + (m.sent || 0), 0);
        data.totalReceived = members.reduce((s, m) => s + (m.received || 0), 0);
        const orgs = new Set(members.map(m => m.email.split('@')[1]?.toLowerCase()).filter(Boolean));
        data.orgCount = orgs.size;
      } else if (filterType === 'organizations' && state.domains) {
        const domainKey = group.label.replace(/^@/, '');
        const users = state.domains.domain_groups[domainKey] ?? [];
        const members = users.map(u => nodesByEmail.get(u.email.toLowerCase())).filter((n): n is GraphNode => n !== undefined);
        data.totalSent = members.reduce((s, m) => s + (m.sent || 0), 0);
        data.totalReceived = members.reduce((s, m) => s + (m.received || 0), 0);
        data.orgCount = 1;
      }
    }

    if (focusGroupFn) {
      focusGroupFn(
        group.label,
        (screenPos) => {
          dispatch({ type: 'SELECT_GROUP', payload: data, position: screenPos });
        },
        () => {
          dispatch({ type: 'SELECT_GROUP', payload: data, position: { x: e.clientX, y: e.clientY } });
        },
      );
    } else {
      dispatch({ type: 'SELECT_GROUP', payload: data, position: { x: e.clientX, y: e.clientY } });
    }
  };

  const handleDelete = async (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.markNotHuman(email);
      dispatch({ type: 'REMOVE_CONTACT', payload: email });
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  };

  const handleRestore = async (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.restore(email);
      window.location.reload();
    } catch (err) {
      console.error('Failed to restore contact:', err);
    }
  };

  const getPlaceClass = (place: number) => {
    if (place === 1) return 'top-1';
    if (place === 2) return 'top-2';
    if (place === 3) return 'top-3';
    return '';
  };

  // Main ranking with places
  let currentPlace = 0;
  let prevScore: number | null = null;
  const contactsWithPlace = contacts.map((contact, index) => {
    if (prevScore !== contact.compositeScore) {
      currentPlace = index + 1;
    }
    prevScore = contact.compositeScore;
    return { ...contact, place: currentPlace };
  });

  // Filtered contacts with places
  let filteredPlace = 0;
  let filteredPrevScore: number | null = null;
  const filteredContactsWithPlace = filteredContacts.map((contact, index) => {
    if (filteredPrevScore !== contact.compositeScore) {
      filteredPlace = index + 1;
    }
    filteredPrevScore = contact.compositeScore;
    return { ...contact, place: filteredPlace };
  });

  const filterTabLabel = isGroupFilter
    ? (filterType === 'messageGroups' ? 'Groups' : 'Orgs')
    : (filterType === 'moreReceived' ? 'Received' : filterType === 'moreSent' ? 'Sent' : 'Filter');

  return (
    <div className="ranking-panel">
      <div className="ranking-header">
        <div className="ranking-tabs">
          <button
            className={`ranking-tab ${rankingTab === 'ranking' ? 'active' : ''}`}
            onClick={() => handleTabChange('ranking')}
          >
            Ranking
          </button>
          {hasFilter && (
            <button
              className={`ranking-tab filter-tab ${rankingTab === 'filtered' ? 'active' : ''}`}
              onClick={() => handleTabChange('filtered')}
            >
              {filterTabLabel}
            </button>
          )}
          <button
            className={`ranking-tab ${rankingTab === 'spam' ? 'active' : ''}`}
            onClick={() => handleTabChange('spam')}
          >
            Spam
          </button>
        </div>
        <button
          className="ranking-toggle"
          title="Hide panel"
          onClick={() => dispatch({ type: 'TOGGLE_PANEL' })}
        >
          −
        </button>
      </div>

      <input
        type="text"
        className="ranking-search"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {rankingTab === 'ranking' && (
        <div className="ranking-list">
          {contactsWithPlace.map((contact) => (
            <div
              key={contact.email}
              className="ranking-item"
              onClick={(e) => handleContactClick(contact, e)}
            >
              <span className={`ranking-place ${getPlaceClass(contact.place)}`}>
                {contact.place}
              </span>
              <span className="ranking-name" title={contact.name}>
                {contact.name}
              </span>
              <span className="ranking-score">
                {Math.round(contact.compositeScore)}
              </span>
              <button
                className="ranking-delete"
                title="Remove contact"
                onClick={(e) => handleDelete(contact.email, e)}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      {rankingTab === 'filtered' && hasFilter && (
        <div className="ranking-list">
          {isContactFilter && filteredContactsWithPlace.map((contact) => (
            <div
              key={contact.email}
              className="ranking-item"
              onClick={(e) => handleContactClick(contact, e)}
            >
              <span className={`ranking-place ${getPlaceClass(contact.place)}`}>
                {contact.place}
              </span>
              <span className="ranking-name" title={contact.name}>
                {contact.name}
              </span>
              <span className="ranking-score">
                {Math.round(contact.compositeScore)}
              </span>
              <button
                className="ranking-delete"
                title="Remove contact"
                onClick={(e) => handleDelete(contact.email, e)}
              >
                🗑
              </button>
            </div>
          ))}

          {isGroupFilter && groupRanking.map((group, index) => (
            <div
              key={group.label}
              className="ranking-item filter-group-item"
              style={{ cursor: 'pointer' }}
              onClick={(e) => handleGroupClick(group, e)}
            >
              <span className={`ranking-place ${getPlaceClass(index + 1)}`}>
                {index + 1}
              </span>
              <span className="ranking-name filter-group-name" title={group.label} style={{ color: group.color }}>
                {group.label}
              </span>
              <span className="ranking-score filter-group-score">
                {Math.round(group.totalScore)}
              </span>
              <span className="filter-group-count">{group.memberCount}</span>
            </div>
          ))}

          {isContactFilter && filteredContactsWithPlace.length === 0 && (
            <div className="ranking-empty">No contacts match this filter</div>
          )}
          {isGroupFilter && groupRanking.length === 0 && (
            <div className="ranking-empty">No groups found</div>
          )}
        </div>
      )}

      {rankingTab === 'spam' && (
        <div className="ranking-list">
          {excludedContacts
            .filter(c => {
              if (!searchQuery) return true;
              const query = searchQuery.toLowerCase();
              return c.name.toLowerCase().includes(query) || c.email.toLowerCase().includes(query);
            })
            .map((contact) => (
              <div key={contact.email} className="spam-item">
                <span className="spam-name" title={contact.email}>
                  {contact.name}
                </span>
                <span className="spam-count">{contact.total}</span>
                <button
                  className="spam-restore"
                  onClick={(e) => handleRestore(contact.email, e)}
                >
                  not spam
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default RankingPanel;
