import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { phaseLabel, progressPercent } from '../../utils/importFormat';

const DISMISSED_KEY = 'import_failure_dismissed';

function readDismissed(): number | null {
  try {
    const value = Number(localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * A strip under the header while an import runs over the current graph, or
 * after one failed. A dismissed failure stays dismissed across reloads.
 */
export function ImportBanner() {
  const { state, dispatch } = useAppContext();
  const [dismissed, setDismissed] = useState<number | null>(readDismissed);
  const status = state.importStatus;
  const open = () => dispatch({ type: 'OPEN_IMPORT' });

  if (status?.state === 'importing') {
    const percent = progressPercent(status.progress);
    return (
      <div className="import-banner">
        <span>
          Importing… {phaseLabel(status.phase)}{percent === null ? '' : ` · ${percent}%`}
        </span>
        <button className="import-link" onClick={open}>Details</button>
      </div>
    );
  }

  if (status?.state === 'failed' && dismissed !== status.failedAt) {
    const dismiss = () => {
      setDismissed(status.failedAt);
      try {
        localStorage.setItem(DISMISSED_KEY, String(status.failedAt));
      } catch {
        // Private mode or blocked storage: dismissed for this page only.
      }
    };
    return (
      <div className="import-banner failed">
        <span className="import-banner-text">
          {status.error === 'cancelled' ? 'Import cancelled. The graph shows the previous data.' : `Import failed: ${status.error}`}
        </span>
        <button className="import-link" onClick={open}>Details</button>
        <button className="import-link" onClick={dismiss}>Dismiss</button>
      </div>
    );
  }

  return null;
}

export default ImportBanner;
