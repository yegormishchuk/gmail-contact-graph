import React, { useRef, useCallback, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useD3Simulation } from '../../hooks/useD3Simulation';
import type { GroupHoverData } from '../../hooks/useD3Simulation';
import { filterData } from '../../utils/filterData';
import { buildOverallGraph } from '../../utils/buildOverallGraph';
import type { GraphData, GraphNode } from '@gmail-graph/shared';
import { GroupTooltip } from '../GroupTooltip';

export function Graph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const { state, dispatch } = useAppContext();

  const selectedNodeRef = useRef(state.selectedNode);
  selectedNodeRef.current = state.selectedNode;

  const [hoveredGroupData, setHoveredGroupData] = useState<GroupHoverData | null>(null);
  const [hoveredGroupPos, setHoveredGroupPos] = useState<{ x: number; y: number } | null>(null);

  const handleNodeClick = useCallback((node: GraphNode, position: { x: number; y: number }) => {
    const isAlreadySelected = selectedNodeRef.current?.email === node.email;
    dispatch({ type: 'SELECT_NODE', payload: isAlreadySelected ? null : node, position: isAlreadySelected ? null : position });
  }, [dispatch]);

  const handleGroupHover = useCallback((data: GroupHoverData | null, position?: { x: number; y: number }) => {
    setHoveredGroupData(data);
    setHoveredGroupPos(position ?? null);
  }, []);

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

  const filteredData = useMemo(() => {
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

  const { resetZoom, focusNode, focusGroup } = useD3Simulation({
    svgRef,
    data: filteredData,
    domains: state.domains,
    messageGroups: state.messageGroups,
    eventGroups: state.eventGroups,
    selectedNode: state.selectedNode,
    limit: state.filters.limit,
    onNodeClick: handleNodeClick,
    onGroupHover: handleGroupHover,
    filterType: state.filters.filterType,
  });

  React.useEffect(() => {
    window.resetGraphZoom = resetZoom;
    window.focusGraphNode = focusNode;
    window.focusGroup = focusGroup;
  }, [resetZoom, focusNode, focusGroup]);

  return (
    <>
      <svg
        ref={svgRef}
        id="graph"
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      <GroupTooltip data={hoveredGroupData} position={hoveredGroupPos} />
    </>
  );
}

export default Graph;
