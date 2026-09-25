import React, { useEffect, useState } from 'react';
import type { ImportStatus } from '@gmail-graph/shared';
import { api } from '../../api/client';
import { useAppContext } from '../../context/AppContext';
import { formatElapsed, phaseLabel, progressPercent } from '../../utils/importFormat';

type Importing = Extract<ImportStatus, { state: 'importing' }>;

interface ImportProgressProps {
  status: Importing;
  /** Whole page (first import) rather than inside the dialog. */
  fullscreen?: boolean;
}

export function ImportProgress({ status, fullscreen = false }: ImportProgressProps) {
  const { dispatch } = useAppContext();
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const cancel = async () => {
    setCancelling(true);
    try {
      dispatch({ type: 'SET_IMPORT_STATUS', payload: await api.cancelImport() });
    } catch (err) {
      console.error('Failed to cancel the import:', err);
      setCancelling(false);
    }
  };

  const percent = progressPercent(status.progress);

  return (
    <div className={`import-progress ${fullscreen ? 'fullscreen' : ''}`}>
      <div className="import-title">Importing your mailbox</div>
      <div className="import-progress-phase">
        <span>{phaseLabel(status.phase)}</span>
        <span>{percent === null ? '' : `${percent}%`}</span>
      </div>
      <div className={`import-bar ${percent === null ? 'indeterminate' : ''}`}>
        <div className="import-bar-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <div className="import-progress-detail">
        <span>{status.detail}</span>
        <span>{formatElapsed(now - status.startedAt)}</span>
      </div>
      {status.hasData && (
        <div className="import-hint">The current graph stays available until the import finishes.</div>
      )}
      <div className="import-buttons">
        {!fullscreen && (
          <button type="button" className="import-btn secondary" onClick={() => dispatch({ type: 'CLOSE_IMPORT' })}>
            Hide
          </button>
        )}
        <button type="button" className="import-btn danger" onClick={cancel} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : 'Cancel import'}
        </button>
      </div>
    </div>
  );
}

export default ImportProgress;
