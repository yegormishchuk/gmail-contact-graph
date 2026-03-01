import React from 'react';
import { useAppContext } from '../../context/AppContext';

export function Header() {
  const { state } = useAppContext();
  const stats = state.rawData?.stats;

  return (
    <header>
      <h1>Gmail Contact Graph</h1>
      {stats && (
        <div className="stats">
          <div className="stat-item">
            <span>Total contacts:</span>
            <span className="stat-value">{stats.totalContacts.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span>Displayed:</span>
            <span className="stat-value">{stats.displayedContacts.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span>Emails received:</span>
            <span className="stat-value">{stats.totalReceived.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <span>Emails sent:</span>
            <span className="stat-value">{stats.totalSent.toLocaleString()}</span>
          </div>
        </div>
      )}
    </header>
  );
}

export default Header;
