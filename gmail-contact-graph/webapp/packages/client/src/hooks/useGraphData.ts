import { useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { api } from '../api/client';

export function useGraphData() {
  const { state, dispatch } = useAppContext();

  useEffect(() => {
    async function loadData() {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });

        const [graph, domains, groups, excluded] = await Promise.all([
          api.getGraph(),
          api.getDomains(),
          api.getMessageGroups(),
          api.getExcludedContacts(),
        ]);

        dispatch({
          type: 'SET_DATA',
          payload: { graph, domains, groups, excluded },
        });
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          payload: err instanceof Error ? err.message : 'Failed to load data',
        });
      }
    }

    loadData();
  }, [dispatch]);

  return {
    loading: state.loading,
    error: state.error,
    data: state.rawData,
  };
}
