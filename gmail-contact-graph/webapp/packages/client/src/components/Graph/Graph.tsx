import React, { useRef, useCallback, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useD3Simulation } from '../../hooks/useD3Simulation';
import { filterData } from '../../utils/filterData';
import type { GraphNode } from '@gmail-graph/shared';

export function Graph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const { state, dispatch } = useAppContext();

  const handleNodeClick = useCallback((node: GraphNode, position: { x: number; y: number }) => {
    dispatch({ type: 'SELECT_NODE', payload: node, position });
  }, [dispatch]);

  const filteredData = useMemo(
    () => state.rawData ? filterData(state.rawData, state.filters) : null,
    [state.rawData, state.filters]
  );

  const { resetZoom } = useD3Simulation({
    svgRef,
    data: filteredData,
    domains: state.domains,
    messageGroups: state.messageGroups,
    selectedNode: state.selectedNode,
    onNodeClick: handleNodeClick,
    filterType: state.filters.filterType,
  });

  // Expose resetZoom to parent via a button in Controls
  // For now, attach to window for testing
  React.useEffect(() => {
    (window as any).resetGraphZoom = resetZoom;
  }, [resetZoom]);

  return (
    <svg
      ref={svgRef}
      id="graph"
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}

export default Graph;
