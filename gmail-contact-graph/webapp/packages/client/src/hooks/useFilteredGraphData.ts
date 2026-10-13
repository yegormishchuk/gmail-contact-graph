import { useMemo } from 'react';
import type { GraphData, GraphNode } from '@gmail-graph/shared';
import { useAppContext } from '../context/AppContext';
import { filterData } from '../utils/filterData';
import { buildOverallGraph } from '../utils/buildOverallGraph';

/**
 * The nodes the graph draws for the current mode and filters. Shared so the
 * detail panel ranks a contact's groups against exactly what is on screen.
 */
export function useFilteredGraphData(): GraphData | null {
  const { state } = useAppContext();

  // Map calendar data to the GraphData shape (so useD3Simulation can render it).
  // compositeScore = calendarScore. Reuse received/sent fill to show
  // organized / total ratio in darker green (receivedColor) over light green.
  const calendarAsGraphData: GraphData | null = useMemo(() => {
    if (!state.calendarData) return null;
    const nodes: GraphNode[] = state.calendarData.nodes.map(n => ({
      id: n.id,
      name: n.name,
      email: n.email,
      isCenter: n.isCenter,
      received: n.organizedEvents,
      sent: Math.max(0, n.totalEvents - n.organizedEvents),
      compositeScore: n.calendarScore,
    }));
    return {
      nodes,
      links: [],
      stats: {
        totalContacts: nodes.length - 1,
        displayedContacts: nodes.length - 1,
        totalReceived: 0,
        totalSent: 0,
      },
    };
  }, [state.calendarData]);

  const overallGraphData: GraphData | null = useMemo(() => {
    if (state.filters.filterType !== 'overall') return null;
    if (!state.rawData) return null;
    return buildOverallGraph(state.rawData, state.calendarData, state.filters.limit).data;
  }, [state.rawData, state.calendarData, state.filters.filterType, state.filters.limit]);

  return useMemo(() => {
    const usesCalendar =
      state.filters.filterType === 'calendar' || state.filters.filterType === 'eventGroups';
    if (usesCalendar) {
      return calendarAsGraphData ? filterData(calendarAsGraphData, state.filters) : null;
    }
    if (state.filters.filterType === 'overall') {
      return overallGraphData ? filterData(overallGraphData, state.filters) : null;
    }
    return state.rawData ? filterData(state.rawData, state.filters) : null;
  }, [state.rawData, calendarAsGraphData, overallGraphData, state.filters]);
}
