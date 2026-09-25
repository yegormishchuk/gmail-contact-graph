import { useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { api } from '../api/client';

const FAST_MS = 1000;
// Slow polling still notices an import started from another tab.
const SLOW_MS = 10_000;

/** Keeps state.importStatus current: every second during an import, else every 10 s. */
export function useImportStatus() {
  const { state, dispatch } = useAppContext();
  const importing = state.importStatus?.state === 'importing';

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    async function poll() {
      try {
        const status = await api.getImportStatus();
        if (!stopped) dispatch({ type: 'SET_IMPORT_STATUS', payload: status });
      } catch (err) {
        console.error('Failed to read the import status:', err);
      }
      if (!stopped) timer = setTimeout(poll, importing ? FAST_MS : SLOW_MS);
    }

    // Re-run whenever the pace changes, starting with an immediate poll.
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [dispatch, importing]);
}
