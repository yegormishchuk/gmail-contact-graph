import { useEffect } from 'react';
import { useAppContext, nextStatusSeq } from '../context/AppContext';
import { api } from '../api/client';

const FAST_MS = 1000;
// Slow polling still notices an import started from another tab.
const SLOW_MS = 10_000;

/**
 * Keeps state.importStatus current: every second during an import (or while
 * the server has not answered yet), else every 10 s.
 */
export function useImportStatus() {
  const { state, dispatch } = useAppContext();
  const fast = state.importStatus === null || state.importStatus.state === 'importing';

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    async function poll() {
      const seq = nextStatusSeq();
      try {
        const status = await api.getImportStatus();
        if (!stopped) dispatch({ type: 'SET_IMPORT_STATUS', payload: status, seq });
      } catch (err) {
        console.error('Failed to read the import status:', err);
        if (!stopped) {
          dispatch({ type: 'SET_IMPORT_STATUS_ERROR', payload: err instanceof Error ? err.message : String(err) });
        }
      }
      if (!stopped) timer = setTimeout(poll, fast ? FAST_MS : SLOW_MS);
    }

    // Re-run whenever the pace changes, starting with an immediate poll.
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [dispatch, fast]);
}
