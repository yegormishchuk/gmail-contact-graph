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
        <button
          className="header-tab header-import"
          onClick={() => dispatch({ type: 'OPEN_IMPORT' })}
          title="Import a mailbox again"
        >
          {state.importStatus?.state === 'importing' ? 'Importing…' : 'Re-import'}
        </button>
      </div>
    </header>
  );
}

export default Header;
