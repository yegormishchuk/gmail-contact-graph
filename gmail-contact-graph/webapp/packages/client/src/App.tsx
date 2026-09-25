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
import { ImportScreen } from './components/ImportScreen';
import { ImportProgress } from './components/ImportProgress';
import { ImportBanner } from './components/ImportBanner';
import { ImportDialog } from './components/ImportDialog';
import { useImportStatus } from './hooks/useImportStatus';

function AppContent() {
  const { state, dispatch } = useAppContext();
  useImportStatus();
  const { loading, error } = useGraphData();
  const status = state.importStatus;

  if (!status) {
    return (
      <div className="container">
        <div className="loading">
          {state.importStatusError
            ? `Can't reach the server (${state.importStatusError}). Retrying…`
            : 'Loading…'}
        </div>
      </div>
    );
  }

  // Nothing to show yet: the first import, from choosing a file to its end.
  if (status.state === 'empty' || (status.state === 'failed' && !status.hasData)) {
    return (
      <div className="container import-page">
        <ImportScreen />
      </div>
    );
  }
  if (status.state === 'importing' && !status.hasData) {
    return (
      <div className="container import-page">
        <ImportProgress status={status} fullscreen />
      </div>
    );
  }

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
        <ImportBanner />
        <ImportDialog />
        <div className="loading empty-state">
          <p>Error: {error}</p>
          <button className="import-btn primary" onClick={() => dispatch({ type: 'OPEN_IMPORT' })}>
            Import again
          </button>
        </div>
      </div>
    );
  }

  if (state.rawData?.stats.totalContacts === 0) {
    return (
      <div className="container">
        <ImportBanner />
        <ImportDialog />
        <div className="loading empty-state">
          <p className="empty-state-title">No contacts to show</p>
          <p>
            Your data has zero good contacts: no one in the mailbox passed the
            filters as someone you actually exchange emails with.
          </p>
          <p>Please check that:</p>
          <ul>
            <li>the <code>.mbox</code> file in <code>data/Email/</code> is the right Gmail export</li>
            <li>the email you imported with is the Gmail address that mailbox belongs to</li>
          </ul>
          <p>Then import again.</p>
          <button className="import-btn primary" onClick={() => dispatch({ type: 'OPEN_IMPORT' })}>
            Import again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <Header />
      <ImportBanner />
      <ImportDialog />
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

// The intro animates the contacts, so it waits until there is data: after
// the first import when the webapp starts without any.
function Intro() {
  const { state } = useAppContext();
  const [showIntro, setShowIntro] = useState(!localStorage.getItem('intro_seen'));
  if (!showIntro || state.dataVersion === null) return null;
  return <IntroSequence onComplete={() => setShowIntro(false)} />;
}

function App() {
  return (
    <AppProvider>
      <AppContent />
      <Intro />
    </AppProvider>
  );
}

export default App;
