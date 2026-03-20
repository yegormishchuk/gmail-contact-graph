import React from 'react';
import { useAppContext } from '../../context/AppContext';

export function Header() {
  const { state, dispatch } = useAppContext();

  return (
    <header>
      <h1>Gmail Contact Graph</h1>
      <div className="header-tabs">
        <button
          className={`header-tab ${state.activeTab === 'graph' ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'SET_TAB', payload: 'graph' })}
        >
          Graph
        </button>
        <button
          className={`header-tab ${state.activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'SET_TAB', payload: 'stats' })}
        >
          Statistics
        </button>
      </div>
    </header>
  );
}

export default Header;
