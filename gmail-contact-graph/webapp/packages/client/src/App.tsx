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
