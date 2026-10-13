import React, { useRef, useCallback, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useD3Simulation } from '../../hooks/useD3Simulation';
import type { GroupHoverData } from '../../hooks/useD3Simulation';
import { useFilteredGraphData } from '../../hooks/useFilteredGraphData';
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

  const filteredData = useFilteredGraphData();

  const { resetZoom, focusNode, focusGroup } = useD3Simulation({
    svgRef,
    data: filteredData,
    domains: state.domains,
    messageGroups: state.messageGroups,
    eventGroups: state.eventGroups,
    selectedNode: state.selectedNode,
    isolatedGroupId: state.isolatedGroupId,
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
