import React from 'react';
import { api, resetDemo } from '../../api/client';
import { useAppContext, nextStatusSeq } from '../../context/AppContext';

const REPO_URL = 'https://github.com/yegormishchuk/gmail-contact-graph';

/** A strip at the top of every page of the hosted demo. */
export function DemoBanner() {
  const { state, dispatch } = useAppContext();
  if (!state.importStatus?.demo) return null;

  const reset = async () => {
    resetDemo();
    const seq = nextStatusSeq();
    try {
      dispatch({ type: 'SET_IMPORT_STATUS', payload: await api.getImportStatus(), seq });
    } catch (err) {
      // The next poll picks the empty state up.
      console.error('Failed to read the import status:', err);
    }
  };

  return (
    <div className="import-banner demo-banner">
      <span className="import-banner-text">
        Demo with a generated mailbox — no real email. Your import lives in this browser; editing contacts is disabled.
      </span>
      <a className="import-link" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
      <a className="import-link" href={`${REPO_URL}#quick-start`} target="_blank" rel="noreferrer">
        Run it on your own mailbox
      </a>
      <button className="import-link" onClick={reset}>Reset demo</button>
    </div>
  );
}

export default DemoBanner;
