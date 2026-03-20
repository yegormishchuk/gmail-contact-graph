import React from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { useGraphData } from './hooks/useGraphData';
import { Graph } from './components/Graph';
import { Header } from './components/Header';
import { Controls } from './components/Controls';
import { RankingPanel } from './components/RankingPanel';
import { Legend } from './components/Legend';
import { Tooltip } from './components/Tooltip';

function AppContent() {
  const { state, dispatch } = useAppContext();
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
      <div id="graph-container">
        <Graph />
        <RankingPanel />
        <Controls />
        <Legend />
        {state.selectedNode && <Tooltip />}
      </div>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
