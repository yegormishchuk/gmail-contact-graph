import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { api } from '../../api/client';
import type { GraphNode } from '@gmail-graph/shared';

export function RankingPanel() {
  const { state, dispatch } = useAppContext();
  const [searchQuery, setSearchQuery] = useState('');

  const { rawData, excludedContacts, rankingTab, panelVisible } = state;

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
          // Node not in current filtered view — still select but use panel click position
          dispatch({ type: 'SELECT_NODE', payload: contact, position: { x: e.clientX, y: e.clientY } });
        },
      );
    } else {
      dispatch({ type: 'SELECT_NODE', payload: contact, position: { x: e.clientX, y: e.clientY } });
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
      // Reload page to get fresh data
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

  // Calculate places with ties
  let currentPlace = 0;
  let prevScore: number | null = null;
  const contactsWithPlace = contacts.map((contact, index) => {
    if (prevScore !== contact.compositeScore) {
      currentPlace = index + 1;
    }
    prevScore = contact.compositeScore;
    return { ...contact, place: currentPlace };
  });

  return (
    <div className="ranking-panel">
      <div className="ranking-header">
        <div className="ranking-tabs">
          <button
            className={`ranking-tab ${rankingTab === 'ranking' ? 'active' : ''}`}
            data-tab="ranking"
            onClick={() => handleTabChange('ranking')}
          >
            Ranking
          </button>
          <button
            className={`ranking-tab ${rankingTab === 'spam' ? 'active' : ''}`}
            data-tab="spam"
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
