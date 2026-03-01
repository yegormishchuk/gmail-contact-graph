import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphData, GraphNode, DomainGroups, MessageGroups } from '@gmail-graph/shared';
import { graphConfig } from '../utils/graphConfig';
import { getNodeRadius } from '../utils/filterData';

interface UseD3SimulationOptions {
  svgRef: React.RefObject<SVGSVGElement>;
  data: GraphData | null;
  domains: DomainGroups | null;
  messageGroups: MessageGroups | null;
  onNodeClick: (node: GraphNode) => void;
}

export function useD3Simulation(options: UseD3SimulationOptions) {
  const simulationRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const resetZoom = useCallback(() => {
    if (!options.svgRef.current || !zoomRef.current) return;
    const svg = d3.select(options.svgRef.current);
    transformRef.current = d3.zoomIdentity;
    svg.transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity);
  }, [options.svgRef]);

  useEffect(() => {
    if (!options.svgRef.current || !options.data) return;

    const svg = d3.select(options.svgRef.current);
    const container = svg.node()?.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    // Clear previous content
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // Calculate max score for node sizing
    const maxScore = d3.max(options.data.nodes.filter(n => !n.isCenter), d => d.compositeScore) || 1;

    // Create defs for patterns
    const defs = svg.append('defs');

    // Hatching pattern for unclear contacts
    const hatchPattern = defs.append('pattern')
      .attr('id', 'hatch-pattern')
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6)
      .attr('height', 6)
      .attr('patternTransform', 'rotate(45)');
    hatchPattern.append('line')
      .attr('x1', 0).attr('y1', 0)
      .attr('x2', 0).attr('y2', 6)
      .attr('stroke', 'rgba(255, 255, 255, 0.4)')
      .attr('stroke-width', 1.5);

    // Main group with zoom
    const g = svg.append('g');

    // Setup zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        g.attr('transform', event.transform.toString());
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // Restore previous transform
    if (transformRef.current !== d3.zoomIdentity) {
      svg.call(zoom.transform, transformRef.current);
    }

    // Stop previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    // Create deep copy of nodes for D3 mutation
    const nodes: GraphNode[] = options.data.nodes.map(n => ({ ...n }));

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(graphConfig.chargeStrength))
      .force('center', d3.forceCenter(centerX, centerY))
      .force('collision', d3.forceCollide<GraphNode>()
        .radius(d => getNodeRadius(d, maxScore) + graphConfig.collisionPadding))
      .force('x', d3.forceX(centerX).strength(graphConfig.centerStrength))
      .force('y', d3.forceY(centerY).strength(graphConfig.centerStrength));

    simulationRef.current = simulation;

    // Fix center node position
    nodes.forEach(node => {
      if (node.isCenter) {
        node.fx = centerX;
        node.fy = centerY;
      }
    });

    // Create link groups (for domain/group connections when node clicked)
    const domainLinksGroup = g.append('g').attr('class', 'domain-links');
    const groupLinksGroup = g.append('g').attr('class', 'group-links');

    // Create nodes group
    const nodesGroup = g.append('g').attr('class', 'nodes');

    // Create node groups
    const nodeGroups = nodesGroup.selectAll<SVGGElement, GraphNode>('g.node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', d => {
        let classes = d.isCenter ? 'node node-center' : 'node node-contact';
        if (d.notClear) classes += ' node-unclear';
        return classes;
      });

    // Add circles to each node
    nodeGroups.each(function(d, i) {
      const group = d3.select(this);
      const radius = getNodeRadius(d, maxScore);

      if (d.isCenter) {
        // Center node - solid circle
        group.append('circle')
          .attr('r', radius)
          .attr('fill', graphConfig.centerColor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 4);
      } else {
        // Contact node - fill level showing received/sent ratio
        const total = (d.sent || 0) + (d.received || 0);
        const receivedRatio = total > 0 ? d.received / total : 0.5;

        const clipId = `clip-node-${i}`;

        // Clip path
        const nodeDefs = group.append('defs');
        nodeDefs.append('clipPath')
          .attr('id', clipId)
          .append('circle')
          .attr('r', radius);

        const clipped = group.append('g')
          .attr('clip-path', `url(#${clipId})`);

        // Background: sent color (green)
        clipped.append('rect')
          .attr('x', -radius)
          .attr('y', -radius)
          .attr('width', radius * 2)
          .attr('height', radius * 2)
          .attr('fill', graphConfig.sentColor);

        // Received color (blue) fills from bottom up
        const fillHeight = radius * 2 * receivedRatio;
        clipped.append('rect')
          .attr('x', -radius)
          .attr('y', radius - fillHeight)
          .attr('width', radius * 2)
          .attr('height', fillHeight)
          .attr('fill', graphConfig.receivedColor);

        // Border
        const hasSent = d.sent > 0;
        group.append('circle')
          .attr('r', radius)
          .attr('fill', 'none')
          .attr('stroke', hasSent ? graphConfig.sentColor : 'rgba(255,255,255,0.3)')
          .attr('stroke-width', hasSent ? graphConfig.borderWidth : 1.5)
          .attr('class', 'node-border');

        // Hatching overlay for unclear contacts
        if (d.notClear) {
          group.append('circle')
            .attr('r', radius)
            .attr('fill', 'url(#hatch-pattern)')
            .attr('class', 'node-hatch');
        }
      }
    });

    // Create labels
    const labels = g.append('g')
      .attr('class', 'labels')
      .selectAll<SVGTextElement, GraphNode>('text')
      .data(nodes)
      .enter()
      .append('text')
      .attr('class', d => d.isCenter ? 'label label-center' : 'label')
      .attr('text-anchor', 'middle')
      .text(d => {
        const name = d.name;
        if (d.isCenter) return name;
        return name.length > 12 ? name.substring(0, 10) + '...' : name;
      });

    // Node click handler
    nodeGroups.on('click', function(event, d) {
      if (d.isCenter) return;
      event.stopPropagation();
      options.onNodeClick(d);
    });

    // Update positions on simulation tick
    simulation.on('tick', () => {
      nodeGroups.attr('transform', d => `translate(${d.x || 0}, ${d.y || 0})`);

      labels
        .attr('x', d => d.x || 0)
        .attr('y', d => (d.y || 0) + getNodeRadius(d, maxScore) + 15);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [options.data, options.svgRef, options.onNodeClick, options.domains, options.messageGroups]);

  return {
    resetZoom,
  };
}
