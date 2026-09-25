import { useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { api, ApiStateError } from '../api/client';

/** Loads the graph data, and loads it again whenever an import replaces it. */
export function useGraphData() {
  const { state, dispatch } = useAppContext();
  const { dataVersion } = state;

  useEffect(() => {
    if (dataVersion === null) return;
    let stale = false;

    async function loadData() {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });

        const [graph, domains, groups, excluded, calendarGraph, calendarStats, eventGroups] = await Promise.all([
          api.getGraph(),
          api.getDomains(),
          api.getMessageGroups(),
          api.getExcludedContacts(),
          api.getCalendarGraph(),
          api.getCalendarStats(),
          api.getEventGroups(),
        ]);
        if (stale) return;

        dispatch({
          type: 'SET_DATA',
          payload: { graph, domains, groups, excluded },
        });
        dispatch({
          type: 'SET_CALENDAR_DATA',
          payload: { graph: calendarGraph, stats: calendarStats, eventGroups },
        });
      } catch (err) {
        // The database went away or is not there yet; the import status
        // poll moves the page to the import screen.
        if (stale || err instanceof ApiStateError) return;
        dispatch({
          type: 'SET_ERROR',
          payload: err instanceof Error ? err.message : 'Failed to load data',
        });
      }
    }

    loadData();
    return () => {
      stale = true;
    };
  }, [dispatch, dataVersion]);

  return {
    loading: state.loading,
    error: state.error,
    data: state.rawData,
  };
}
