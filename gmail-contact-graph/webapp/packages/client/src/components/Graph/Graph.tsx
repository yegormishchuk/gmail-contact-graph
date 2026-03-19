import React, { useRef, useCallback, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useD3Simulation } from '../../hooks/useD3Simulation';
import type { GroupHoverData } from '../../hooks/useD3Simulation';
import { filterData } from '../../utils/filterData';
import type { GraphNode } from '@gmail-graph/shared';
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

  const handleGroupClick = useCallback((data: GroupHoverData | null, position?: { x: number; y: number }) => {
    dispatch({ type: 'SELECT_GROUP', payload: data, position });
  }, [dispatch]);

  const filteredData = useMemo(
    () => state.rawData ? filterData(state.rawData, state.filters) : null,
    [state.rawData, state.filters]
  );

  const { resetZoom, focusNode, focusGroup } = useD3Simulation({
    svgRef,
    data: filteredData,
    domains: state.domains,
    messageGroups: state.messageGroups,
    selectedNode: state.selectedNode,
    limit: state.filters.limit,
    onNodeClick: handleNodeClick,
    onGroupHover: handleGroupHover,
    onGroupClick: handleGroupClick,
    filterType: state.filters.filterType,
  });

  React.useEffect(() => {
    (window as any).resetGraphZoom = resetZoom;
    (window as any).focusGraphNode = focusNode;
    (window as any).focusGroup = focusGroup;
  }, [resetZoom, focusNode, focusGroup]);

  // Show hover tooltip only when no group is persistently selected
  const showHoverTooltip = !state.selectedGroup;

  return (
    <>
      <svg
        ref={svgRef}
        id="graph"
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {showHoverTooltip && <GroupTooltip data={hoveredGroupData} position={hoveredGroupPos} />}
    </>
  );
}

export default Graph;
