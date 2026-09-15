import React, { useState } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { useGraphData } from './hooks/useGraphData';
import { Graph } from './components/Graph';
import { Header } from './components/Header';
import { Controls } from './components/Controls';
import { RankingPanel } from './components/RankingPanel';
import { Legend } from './components/Legend';
import { Tooltip } from './components/Tooltip';
import { StatsPage } from './components/StatsPage';
import { IntroSequence } from './components/IntroSequence';

function AppContent() {
  const { state } = useAppContext();
  const { loading, error } = useGraphData();

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading graph...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="loading">Error: {error}</div>
      </div>
    );
  }

  if (state.rawData?.stats.totalContacts === 0) {
    return (
      <div className="container">
        <div className="loading empty-state">
          <p className="empty-state-title">No contacts to show</p>
          <p>
            Your data has zero good contacts: no one in the mailbox passed the
            filters as someone you actually exchange emails with.
          </p>
          <p>Please check that:</p>
          <ul>
            <li>the <code>.mbox</code> file in <code>data/Email/</code> is the right Gmail export</li>
            <li><code>USER_EMAIL</code> in <code>.env</code> is the Gmail address that mailbox belongs to</li>
          </ul>
          <p>Then re-run <code>make process-all</code> and restart the webapp.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <Header />
      <div
        id="graph-container"
        className={state.activeTab === 'stats' ? 'graph-tab-hidden' : ''}
      >
        <Graph />
        <RankingPanel />
        <Controls />
        <Legend />
        {state.selectedNode && <Tooltip />}
      </div>
      {state.activeTab === 'stats' && <StatsPage />}
    </div>
  );
}

function App() {
  const [showIntro, setShowIntro] = useState(!localStorage.getItem('intro_seen'));

  return (
    <AppProvider>
      <AppContent />
      {showIntro && <IntroSequence onComplete={() => setShowIntro(false)} />}
    </AppProvider>
  );
}

export default App;
