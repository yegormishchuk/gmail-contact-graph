import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphData, GraphNode, DomainGroups, MessageGroups, EventGroups } from '@gmail-graph/shared';
import { graphConfig } from '../utils/graphConfig';
import { getNodeRadius } from '../utils/filterData';
import type { GroupHoverData } from '../utils/groupTypes';
export type { GroupHoverData };

const MIN_MSG_GROUP_SIZE = 3;
const ROPE_MAX_SIZE = 8;
const MAX_EVENT_ROPES = 8;

interface RopeLink {
  source: GraphNode;
  target: GraphNode;
}

interface UseD3SimulationOptions {
  svgRef: React.RefObject<SVGSVGElement>;
  data: GraphData | null;
  domains: DomainGroups | null;
  messageGroups: MessageGroups | null;
  eventGroups: EventGroups | null;
  selectedNode: GraphNode | null;
  filterType: 'overall' | 'gmail' | 'calendar' | 'messageGroups' | 'organizations' | 'eventGroups';
  limit: number;
  onNodeClick: (node: GraphNode, position: { x: number; y: number }) => void;
  onGroupHover?: (data: GroupHoverData | null, position?: { x: number; y: number }) => void;
}

export function useD3Simulation(options: UseD3SimulationOptions) {
  const simulationRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null);
  const groupSimulationsRef = useRef<d3.Simulation<GraphNode, undefined>[]>([]);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Refs for group visualization (stable across re-renders)
  const domainLinksGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const groupLinksGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesDataRef = useRef<GraphNode[]>([]);
  const groupCellsRef = useRef<{ label: string; cx: number; cy: number; r: number }[]>([]);

  const resetZoom = useCallback(() => {
    if (!options.svgRef.current || !zoomRef.current) return;
    const svg = d3.select(options.svgRef.current);
    transformRef.current = d3.zoomIdentity;
    svg.transition().duration(500).call(zoomRef.current.transform, d3.zoomIdentity);
  }, [options.svgRef]);

  useEffect(() => {
    if (!options.svgRef.current || !options.data) return;

    const isGroupMode =
      options.filterType === 'messageGroups' ||
      options.filterType === 'organizations' ||
      options.filterType === 'eventGroups';

    // Stop and clear any previous group simulations
    groupSimulationsRef.current.forEach(s => s.stop());
    groupSimulationsRef.current = [];

    if (isGroupMode) {
      // SVG setup
      const svg = d3.select(options.svgRef.current!);
      const container = svg.node()?.parentElement;
      if (!container) return () => {};
      const width = container.clientWidth;
      const height = container.clientHeight;
      svg.selectAll('*').remove();
      svg.attr('width', width).attr('height', height);

      // Main group with zoom/pan (same as common graph)
      const g = svg.append('g');

      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 3])
        .on('zoom', (event) => {
          transformRef.current = event.transform;
          g.attr('transform', event.transform.toString());
        });
      zoomRef.current = zoom;
      svg.call(zoom);
      svg.on('dblclick.zoom', null);

      // Prepare groups
      type GroupEntry = { label: string; members: GraphNode[] };
      const groups: GroupEntry[] = [];

      const nodesByEmail = new Map(
        options.data.nodes.filter(n => !n.isCenter).map(n => [n.email.toLowerCase(), n])
      );
      const centerNode = options.data.nodes.find(n => n.isCenter);

      if (options.filterType === 'organizations' && options.domains) {
        Object.entries(options.domains.domain_groups).forEach(([domain, users]) => {
          const members = users
            .map(u => nodesByEmail.get(u.email.toLowerCase()))
            .filter((n): n is GraphNode => n !== undefined);
          if (members.length >= MIN_MSG_GROUP_SIZE) {
            groups.push({ label: `@${domain}`, members });
          }
        });
      } else if (options.filterType === 'messageGroups' && options.messageGroups) {
        Object.entries(options.messageGroups.groups).forEach(([subject, emails]) => {
          const members = emails
            .map(e => nodesByEmail.get(e.toLowerCase()))
            .filter((n): n is GraphNode => n !== undefined);
          if (members.length >= MIN_MSG_GROUP_SIZE) {
            groups.push({ label: subject, members });
          }
        });
      } else if (options.filterType === 'eventGroups' && options.eventGroups) {
        Object.entries(options.eventGroups.groups).forEach(([label, emails]) => {
          const members = emails
            .map(e => nodesByEmail.get(e.toLowerCase()))
            .filter((n): n is GraphNode => n !== undefined);
          if (members.length >= MIN_MSG_GROUP_SIZE) {
            groups.push({ label, members });
          }
        });
      }

      // Sort groups by total composite score descending, then limit to top N
      groups.sort((a, b) => {
        const scoreA = a.members.reduce((s, m) => s + m.compositeScore, 0);
        const scoreB = b.members.reduce((s, m) => s + m.compositeScore, 0);
        return scoreB - scoreA;
      });
      groups.splice(options.limit);

      // Guard: centerNode must exist
      if (!centerNode) return () => {};

      // If no qualifying groups, show empty state
      if (groups.length === 0) {
        svg.attr('height', 200);
        g.append('text')
          .attr('x', width / 2).attr('y', 100)
          .attr('text-anchor', 'middle')
          .attr('fill', '#555')
          .attr('font-size', '14px')
          .text('No groups with 3+ contacts found');
        return () => {};
      }

      // Ring layout constants — shared between radius computation and actual rendering
      const INNER_GAP = 20;
      const RING_GAP = 12;
      const OUTER_MARGIN = 32;
      const PADDING = 60;

      // Compute the boundary circle radius by dry-running the ring layout,
      // so it always contains all contacts regardless of group size.
      const computeGroupR = (members: GraphNode[]): number => {
        const sorted = [...members].sort((a, b) => b.compositeScore - a.compositeScore);
        const maxScore = sorted[0]?.compositeScore || 1;
        let ringR = graphConfig.centerNodeRadius + INNER_GAP;
        let rem = sorted.slice();
        let lastNodeR = graphConfig.minNodeRadius;
        while (rem.length > 0) {
          const nodeR = getNodeRadius(rem[0], maxScore);
          lastNodeR = nodeR;
          const capacity = Math.max(1, Math.floor(2 * Math.PI * ringR / (nodeR * 2 + 8)));
          rem.splice(0, Math.min(capacity, rem.length));
          if (rem.length > 0) ringR += nodeR * 2 + RING_GAP;
        }
        // boundary = outermost ring center + node radius + margin + collision headroom
        return ringR + lastNodeR + OUTER_MARGIN + graphConfig.collisionPadding;
      };

      const groupColors = graphConfig.groupColors;

      type Cell = { group: GroupEntry; cx: number; cy: number; r: number; color: string };
      const cells: Cell[] = [];

      let curX = PADDING;
      let curY = PADDING;
      let rowMaxY = 0;

      groups.forEach((group, i) => {
        const r = computeGroupR(group.members);
        if (curX + 2 * r > width - PADDING && curX > PADDING) {
          curX = PADDING;
          curY = rowMaxY + PADDING;
        }
        const cx = curX + r;
        const cy = curY + r;
        curX = cx + r + PADDING;
        rowMaxY = Math.max(rowMaxY, cy + r);
        cells.push({ group, cx, cy, r, color: groupColors[i % groupColors.length] });
      });

      // Store cell positions for focusGroup
      groupCellsRef.current = cells.map(c => ({ label: c.group.label, cx: c.cx, cy: c.cy, r: c.r }));

      // Center the layout in the viewport initially
      const totalWidth = cells.length > 0 ? Math.max(...cells.map(c => c.cx + c.r)) + PADDING : width;
      const totalHeight = rowMaxY + PADDING;
      const initialTranslateX = (width - totalWidth) / 2;
      const initialTranslateY = (height - totalHeight) / 2;
      const initialTransform = d3.zoomIdentity.translate(initialTranslateX, initialTranslateY);
      svg.call(zoom.transform, initialTransform);
      transformRef.current = initialTransform;

      // Create defs for hatch pattern
      const defs = svg.append('defs');
      const hatchPattern = defs.append('pattern')
        .attr('id', 'hatch-pattern')
        .attr('patternUnits', 'userSpaceOnUse')
        .attr('width', 6).attr('height', 6)
        .attr('patternTransform', 'rotate(45)');
      hatchPattern.append('line')
        .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
        .attr('stroke', 'rgba(255, 255, 255, 0.4)').attr('stroke-width', 1.5);

      // Render each group
      cells.forEach(({ group, cx, cy, r, color }, groupIdx) => {
        const groupG = g.append('g')
          .attr('class', 'group-cell')
          .attr('data-cx', cx)
          .attr('data-cy', cy)
          .style('transition', 'transform 0.25s ease, opacity 0.25s ease');

        // Boundary circle
        groupG.append('circle')
          .attr('cx', cx).attr('cy', cy).attr('r', r)
          .attr('fill', color + '08')
          .attr('stroke', color)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '6 3')
          .attr('opacity', 0.7);

        // Group label above circle
        const truncated = group.label.length > 25 ? group.label.substring(0, 23) + '…' : group.label;
        groupG.append('text')
          .attr('x', cx).attr('y', cy - r - 4)
          .attr('text-anchor', 'middle')
          .attr('fill', color)
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .attr('pointer-events', 'none')
          .style('text-shadow', '0 1px 4px rgba(0,0,0,0.9)')
          .text(truncated);

        // Center "me" node — same style as common graph
        groupG.append('circle')
          .attr('cx', cx).attr('cy', cy)
          .attr('r', graphConfig.centerNodeRadius)
          .attr('fill', graphConfig.centerColor)
          .attr('stroke', '#fff')
          .attr('stroke-width', 4);
        groupG.append('text')
          .attr('x', cx).attr('y', cy + graphConfig.centerNodeRadius + 15)
          .attr('text-anchor', 'middle')
          .attr('class', 'label label-center')
          .attr('pointer-events', 'none')
          .text('me');

        // Contact nodes — sorted by score descending (highest = closest to center)
        const sorted = [...group.members].sort((a, b) => b.compositeScore - a.compositeScore);
        const maxGroupScore = sorted[0]?.compositeScore || 1;
        const nodesGroup = groupG.append('g').attr('class', 'nodes');

        // Pre-position contacts in concentric rings: inner ring = highest-score contacts
        const nodePositions = new Map<string, { x: number; y: number }>();
        let ringR = graphConfig.centerNodeRadius + INNER_GAP;
        let ringRemaining = sorted.slice();

        while (ringRemaining.length > 0) {
          const nodeR = getNodeRadius(ringRemaining[0], maxGroupScore);
          const maxRingR = r - OUTER_MARGIN - nodeR;
          const clampedRingR = Math.min(ringR, maxRingR);
          const isLastRing = clampedRingR >= maxRingR;
          const circumference = 2 * Math.PI * clampedRingR;
          const capacity = isLastRing
            ? ringRemaining.length
            : Math.max(1, Math.floor(circumference / (nodeR * 2 + 8)));
          const batch = ringRemaining.splice(0, capacity);

          batch.forEach((node, i) => {
            const angle = -Math.PI / 2 + (i / batch.length) * 2 * Math.PI;
            nodePositions.set(node.email, {
              x: cx + clampedRingR * Math.cos(angle),
              y: cy + clampedRingR * Math.sin(angle),
            });
          });

          if (isLastRing) break;
          ringR = clampedRingR + nodeR * 2 + RING_GAP;
        }

        const simNodes: GraphNode[] = group.members.map(n => {
          const pos = nodePositions.get(n.email) || { x: cx, y: cy };
          return { ...n, x: pos.x, y: pos.y };
        });

        const nodeGroups = nodesGroup.selectAll<SVGGElement, GraphNode>('g.node')
          .data(simNodes)
          .enter()
          .append('g')
          .attr('class', d => {
            let cls = 'node node-contact';
            if (d.notClear) cls += ' node-unclear';
            return cls;
          });

        nodeGroups.each(function(d, nodeIdx) {
          const nodeG = d3.select(this);
          const radius = getNodeRadius(d, maxGroupScore);
          const total = (d.sent || 0) + (d.received || 0);
          const receivedRatio = total > 0 ? d.received / total : 0.5;

          const clipId = `clip-g${groupIdx}-node-${nodeIdx}`;
          const nodeDefs = nodeG.append('defs');
          nodeDefs.append('clipPath')
            .attr('id', clipId)
            .append('circle').attr('r', radius);

          const clipped = nodeG.append('g').attr('clip-path', `url(#${clipId})`);
          clipped.append('rect')
            .attr('x', -radius).attr('y', -radius)
            .attr('width', radius * 2).attr('height', radius * 2)
            .attr('fill', graphConfig.sentColor);

          const fillHeight = radius * 2 * receivedRatio;
          clipped.append('rect')
            .attr('x', -radius).attr('y', radius - fillHeight)
            .attr('width', radius * 2).attr('height', fillHeight)
            .attr('fill', graphConfig.receivedColor);

          const hasSent = d.sent > 0;
          nodeG.append('circle')
            .attr('r', radius).attr('fill', 'none')
            .attr('stroke', hasSent ? graphConfig.sentColor : 'rgba(255,255,255,0.3)')
            .attr('stroke-width', hasSent ? graphConfig.borderWidth : 1.5)
            .attr('class', 'node-border');

          if (d.notClear) {
            nodeG.append('circle')
              .attr('r', radius)
              .attr('fill', 'url(#hatch-pattern)')
              .attr('class', 'node-hatch');
          }
        });

        // Labels
        const labelsG = groupG.append('g').attr('class', 'labels');
        const labels = labelsG.selectAll<SVGTextElement, GraphNode>('text')
          .data(simNodes)
          .enter()
          .append('text')
          .attr('class', 'label')
          .attr('text-anchor', 'middle')
          .text(d => {
            const name = d.name;
            return name.length > 12 ? name.substring(0, 10) + '...' : name;
          });

        // Click handler
        nodeGroups.on('click', function(event, d) {
          if (d.isCenter) return;
          event.stopPropagation();
          options.onNodeClick(d, { x: event.clientX, y: event.clientY });
        });

        // Group hover stats
        const totalSent = group.members.reduce((sum, m) => sum + (m.sent || 0), 0);
        const totalReceived = group.members.reduce((sum, m) => sum + (m.received || 0), 0);
        const orgSet = new Set(group.members.map(m => m.email.split('@')[1]?.toLowerCase()).filter(Boolean));
        const groupHoverData: GroupHoverData = {
          label: group.label,
          memberCount: group.members.length,
          totalSent,
          totalReceived,
          orgCount: orgSet.size,
          color,
        };

        groupG
          .on('mouseenter', function(event: MouseEvent) {
            // Scale up hovered group around its center
            d3.select(this).raise()
              .style('transform', `translate(${cx}px,${cy}px) scale(1.06) translate(${-cx}px,${-cy}px)`);
            // Dim other groups
            g.selectAll<SVGGElement, unknown>('.group-cell').filter(function() { return this !== event.currentTarget; })
              .style('opacity', '0.38');
            if (options.onGroupHover) {
              options.onGroupHover(groupHoverData, { x: event.clientX, y: event.clientY });
            }
          })
          .on('mousemove', function(event: MouseEvent) {
            if (options.onGroupHover) {
              options.onGroupHover(groupHoverData, { x: event.clientX, y: event.clientY });
            }
          })
          .on('mouseleave', function() {
            d3.select(this).style('transform', null);
            g.selectAll<SVGGElement, unknown>('.group-cell').style('opacity', null);
            if (options.onGroupHover) {
              options.onGroupHover(null);
            }
          })
          .on('click', function(event: MouseEvent) {
            // Don't trigger from contact node clicks (they stop propagation)
            event.stopPropagation();
            // Pan camera to center on this group
            const vw = container.clientWidth;
            const vh = container.clientHeight;
            const scale = Math.min(2.5, Math.min(vw, vh) / (r * 2.8));
            const tx = vw / 2 - scale * cx;
            const ty = vh / 2 - scale * cy;
            const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
            transformRef.current = transform;
            svg.transition().duration(600).call(zoom.transform, transform);
          });

        // Simulation — contacts are already pre-positioned; only collision polish needed
        const centerPhantom: GraphNode = {
          ...centerNode,
          isCenter: true,
          fx: cx,
          fy: cy,
          x: cx,
          y: cy,
        };
        const allSimNodes = [centerPhantom, ...simNodes];

        const sim = d3.forceSimulation(allSimNodes)
          .force('x', d3.forceX<GraphNode>(d => {
            if (d.isCenter) return cx;
            const pos = nodePositions.get(d.email);
            return pos ? pos.x : cx;
          }).strength(d => d.isCenter ? 1 : 0.6))
          .force('y', d3.forceY<GraphNode>(d => {
            if (d.isCenter) return cy;
            const pos = nodePositions.get(d.email);
            return pos ? pos.y : cy;
          }).strength(d => d.isCenter ? 1 : 0.6))
          .force('collide', d3.forceCollide<GraphNode>()
            .radius(d => getNodeRadius(d, maxGroupScore) + graphConfig.collisionPadding)
          );

        groupSimulationsRef.current.push(sim);

        sim.on('tick', () => {
          nodeGroups.attr('transform', d => `translate(${d.x || cx},${d.y || cy})`);
          labels
            .attr('x', d => d.x || cx)
            .attr('y', d => (d.y || cy) + getNodeRadius(d, maxGroupScore) + 15);
        });
      }); // end cells.forEach

      return () => {
        groupSimulationsRef.current.forEach(s => s.stop());
        groupSimulationsRef.current = [];
      };
    }
    // else: existing common graph logic continues below unchanged

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
    svg.on('dblclick.zoom', null);

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
    nodesDataRef.current = nodes;

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
    domainLinksGroupRef.current = domainLinksGroup;
    groupLinksGroupRef.current = groupLinksGroup;

    // Create nodes group
    const nodesGroup = g.append('g').attr('class', 'nodes');
    nodesGroupRef.current = nodesGroup;

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
      options.onNodeClick(d, { x: event.clientX, y: event.clientY });
    });

    // Update positions on simulation tick
    simulation.on('tick', () => {
      nodeGroups.attr('transform', d => `translate(${d.x || 0}, ${d.y || 0})`);

      labels
        .attr('x', d => d.x || 0)
        .attr('y', d => (d.y || 0) + getNodeRadius(d, maxScore) + 15);

      // Update rope link positions (data is bound to elements, source/target are live node refs)
      domainLinksGroupRef.current?.selectAll<SVGLineElement, RopeLink>('line')
        .attr('x1', d => d.source.x || 0)
        .attr('y1', d => d.source.y || 0)
        .attr('x2', d => d.target.x || 0)
        .attr('y2', d => d.target.y || 0);
      domainLinksGroupRef.current?.selectAll<SVGTextElement, RopeLink>('text')
        .attr('x', d => ((d.source.x || 0) + (d.target.x || 0)) / 2)
        .attr('y', d => ((d.source.y || 0) + (d.target.y || 0)) / 2 - 4);

      groupLinksGroupRef.current?.selectAll<SVGLineElement, RopeLink>('line')
        .attr('x1', d => d.source.x || 0)
        .attr('y1', d => d.source.y || 0)
        .attr('x2', d => d.target.x || 0)
        .attr('y2', d => d.target.y || 0);
      groupLinksGroupRef.current?.selectAll<SVGTextElement, RopeLink>('text')
        .attr('x', d => ((d.source.x || 0) + (d.target.x || 0)) / 2)
        .attr('y', d => ((d.source.y || 0) + (d.target.y || 0)) / 2 - 4);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [options.data, options.svgRef, options.onNodeClick, options.domains, options.messageGroups, options.eventGroups, options.filterType]);

  // Group visualization effect — runs when selected node or data/groups change
  useEffect(() => {
    const isGroupMode =
      options.filterType === 'messageGroups' ||
      options.filterType === 'organizations' ||
      options.filterType === 'eventGroups';
    if (isGroupMode) return;

    if (!domainLinksGroupRef.current || !groupLinksGroupRef.current || !nodesGroupRef.current) return;

    const nodes = nodesDataRef.current;
    const nodeMap = new Map(nodes.map(n => [n.email.toLowerCase(), n]));

    // ── Fade-out and remove previous ropes ───────────────────────────────────
    domainLinksGroupRef.current.selectAll<SVGElement, unknown>('*')
      .transition('rope-out').duration(200).style('opacity', 0).remove();
    groupLinksGroupRef.current.selectAll<SVGElement, unknown>('*')
      .transition('rope-out').duration(200).style('opacity', 0).remove();

    // ── Animate all contact nodes back to their natural state ─────────────────
    nodesGroupRef.current.selectAll<SVGGElement, GraphNode>('g.node-contact')
      .each(function(d) {
        const el = d3.select(this);
        const hasSent = d.sent > 0;
        const naturalOpacity = d.notClear ? 0.5 : 1;

        el.classed('node-group-member', false);

        el.transition('opacity').duration(320).ease(d3.easeCubicOut)
          .style('opacity', naturalOpacity)
          .on('end', function() {
            d3.select(this as SVGGElement).style('opacity', null);
          });

        el.select<SVGCircleElement>('.node-border')
          .transition('border').duration(320).ease(d3.easeCubicOut)
          .attr('stroke', hasSent ? graphConfig.sentColor : 'rgba(255,255,255,0.3)')
          .attr('stroke-width', hasSent ? graphConfig.borderWidth : 1.5);
      });

    if (!options.selectedNode) return;

    const selectedEmail = options.selectedNode.email.toLowerCase();

    // Calendar view: draw ropes for the event groups containing the selected attendee.
    if (options.filterType === 'calendar') {
      const selectedEventGroups = Object.entries(options.eventGroups?.groups ?? {})
        .filter(([_, emails]) =>
          emails.map(e => e.toLowerCase()).includes(selectedEmail) &&
          emails.length >= MIN_MSG_GROUP_SIZE
        )
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, MAX_EVENT_ROPES);

      const allVisibleMemberEmails = new Set<string>();

      // Always draw a colored rope per event group (no size-based gray-border
      // fallback) so calendar ropes match the Gmail palette/style even for the
      // large attendee lists typical of calendar events.
      selectedEventGroups.forEach(([label, emails], groupIdx) => {
        const memberEmails = emails.map(e => e.toLowerCase());
        memberEmails.filter(e => nodeMap.has(e)).forEach(e => allVisibleMemberEmails.add(e));

        const groupColor = graphConfig.groupColors[groupIdx % graphConfig.groupColors.length];
        drawRope(groupLinksGroupRef.current!, memberEmails, nodeMap, groupColor, label);
      });

      highlightGroupMembers(nodesGroupRef.current!, allVisibleMemberEmails, new Map(), selectedEmail);
      return;
    }

    const emailDomain = selectedEmail.split('@')[1];
    const domainUsers = options.domains?.domain_groups?.[emailDomain] ?? [];

    // Message groups: only those containing selected node with >= MIN_MSG_GROUP_SIZE members
    const selectedMsgGroups = Object.entries(options.messageGroups?.groups ?? {})
      .filter(([_, emails]) =>
        emails.map(e => e.toLowerCase()).includes(selectedEmail) &&
        emails.length >= MIN_MSG_GROUP_SIZE
      )
      .sort(([, a], [, b]) => b.length - a.length);

    // Track visible group members for dimming logic
    const allVisibleMemberEmails = new Set<string>();
    // Large group border colors: email → array of colors to apply
    const largeBorderColors = new Map<string, string[]>();

    // --- Domain group ---
    if (domainUsers.length >= 2) {
      const memberEmails = domainUsers.map(u => u.email.toLowerCase());
      memberEmails.filter(e => nodeMap.has(e)).forEach(e => allVisibleMemberEmails.add(e));

      if (domainUsers.length <= ROPE_MAX_SIZE) {
        drawRope(domainLinksGroupRef.current, memberEmails, nodeMap, graphConfig.domainColor, `@${emailDomain}`);
      } else {
        memberEmails.filter(e => nodeMap.has(e)).forEach(email => {
          const prev = largeBorderColors.get(email) ?? [];
          largeBorderColors.set(email, [...prev, graphConfig.domainColor]);
        });
      }
    }

    // --- Message groups ---
    selectedMsgGroups.forEach(([subject, emails], groupIdx) => {
      const memberEmails = emails.map(e => e.toLowerCase());
      memberEmails.filter(e => nodeMap.has(e)).forEach(e => allVisibleMemberEmails.add(e));

      const groupColor = graphConfig.groupColors[groupIdx % graphConfig.groupColors.length];

      if (memberEmails.length <= ROPE_MAX_SIZE) {
        drawRope(groupLinksGroupRef.current!, memberEmails, nodeMap, groupColor, subject);
      } else {
        memberEmails.filter(e => nodeMap.has(e)).forEach(email => {
          const prev = largeBorderColors.get(email) ?? [];
          largeBorderColors.set(email, [...prev, groupColor]);
        });
      }
    });

    highlightGroupMembers(nodesGroupRef.current!, allVisibleMemberEmails, largeBorderColors, selectedEmail);

  }, [options.selectedNode, options.data, options.domains, options.messageGroups, options.eventGroups, options.filterType]);

  const focusGroup = useCallback((
    label: string,
    onFound: (screenPos: { x: number; y: number }) => void,
    onNotFound?: () => void,
  ) => {
    const cell = groupCellsRef.current.find(c => c.label === label);
    if (!cell || !options.svgRef.current || !zoomRef.current) {
      onNotFound?.();
      return;
    }
    const svgEl = options.svgRef.current;
    const container = svgEl.parentElement;
    if (!container) { onNotFound?.(); return; }
    const vw = container.clientWidth;
    const vh = container.clientHeight;
    const scale = Math.min(2.5, Math.min(vw, vh) / (cell.r * 2.8));
    const tx = vw / 2 - scale * cell.cx;
    const ty = vh / 2 - scale * cell.cy;
    const newTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    transformRef.current = newTransform;
    d3.select(svgEl)
      .transition()
      .duration(600)
      .call(zoomRef.current.transform, newTransform)
      .on('end', () => {
        const rect = svgEl.getBoundingClientRect();
        onFound({ x: rect.left + vw / 2, y: rect.top + vh / 2 });
      });
  }, [options.svgRef]);

  const focusNode = useCallback((
    email: string,
    onFound: (screenPos: { x: number; y: number }) => void,
    onNotFound?: () => void,
  ) => {
    if (!options.svgRef.current || !zoomRef.current) {
      onNotFound?.();
      return;
    }

    const node = nodesDataRef.current.find(n => n.email.toLowerCase() === email.toLowerCase());
    if (!node || node.x === undefined || node.y === undefined) {
      onNotFound?.();
      return;
    }

    const svgEl = options.svgRef.current;
    const svgRect = svgEl.getBoundingClientRect();
    const scale = 1.5;
    const newTx = svgRect.width / 2 - scale * node.x;
    const newTy = svgRect.height / 2 - scale * node.y;
    const newTransform = d3.zoomIdentity.translate(newTx, newTy).scale(scale);

    transformRef.current = newTransform;

    d3.select(svgEl)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, newTransform)
      .on('end', () => {
        const rect = svgEl.getBoundingClientRect();
        onFound({
          x: rect.left + newTransform.applyX(node.x!),
          y: rect.top + newTransform.applyY(node.y!),
        });
      });
  }, [options.svgRef]);

  return {
    resetZoom,
    focusNode,
    focusGroup,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function highlightGroupMembers(
  nodesGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  allVisibleMemberEmails: Set<string>,
  largeBorderColors: Map<string, string[]>,
  selectedEmail: string,
) {
  // Colored borders for members of large (rope-skipped) groups
  if (largeBorderColors.size > 0) {
    nodesGroup.selectAll<SVGGElement, GraphNode>('g.node-contact').each(function (d) {
      const colors = largeBorderColors.get(d.email.toLowerCase());
      if (colors && colors.length > 0) {
        const color = colors.length === 1 ? colors[0] : blendColors(colors);
        const el = d3.select(this);
        el.select<SVGCircleElement>('.node-border')
          .transition('border').duration(420).ease(d3.easeCubicOut)
          .attr('stroke', color)
          .attr('stroke-width', 4)
          .on('end', () => el.classed('node-group-member', true));
      }
    });
  }

  // Fade out non-members
  if (allVisibleMemberEmails.size > 1) {
    nodesGroup.selectAll<SVGGElement, GraphNode>('g.node-contact').each(function (d) {
      const email = d.email.toLowerCase();
      if (!allVisibleMemberEmails.has(email) && email !== selectedEmail) {
        d3.select(this)
          .transition('opacity').duration(380).ease(d3.easeCubicOut)
          .style('opacity', 0.15);
      }
    });
  }

  // Keep the selected node fully visible
  nodesGroup.selectAll<SVGGElement, GraphNode>('g.node-contact')
    .filter(d => d.email.toLowerCase() === selectedEmail)
    .transition('opacity').duration(150)
    .style('opacity', 1);
}

function drawRope(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  memberEmails: string[],
  nodeMap: Map<string, GraphNode>,
  color: string,
  label: string
) {
  const members = memberEmails
    .map(e => nodeMap.get(e))
    .filter((n): n is GraphNode => n !== undefined);

  if (members.length < 2) return;

  // Build cyclic chain; for exactly 2 nodes just one edge avoids overlap
  const linkData: RopeLink[] = members.length === 2
    ? [{ source: members[0], target: members[1] }]
    : members.map((node, i) => ({
        source: node,
        target: members[(i + 1) % members.length],
      }));

  // Staggered draw-in: each line slides in via stroke-dashoffset + fades in
  linkData.forEach((link, i) => {
    group.append('line')
      .datum(link)
      .attr('class', 'rope-line')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 4')
      .attr('stroke-dashoffset', 80)
      .attr('stroke-opacity', 0)
      .attr('x1', link.source.x || 0)
      .attr('y1', link.source.y || 0)
      .attr('x2', link.target.x || 0)
      .attr('y2', link.target.y || 0)
      .transition()
      .duration(520)
      .delay(i * 55)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0)
      .attr('stroke-opacity', 0.78);
  });

  // Label fades in after all lines have appeared
  const first = linkData[0];
  const truncated = label.length > 22 ? label.substring(0, 20) + '…' : label;
  group.append('text')
    .datum(first)
    .attr('fill', color)
    .attr('font-size', '11px')
    .attr('font-weight', '600')
    .attr('text-anchor', 'middle')
    .attr('pointer-events', 'none')
    .style('text-shadow', '0 1px 4px rgba(0,0,0,0.9)')
    .style('opacity', '0')
    .attr('x', ((first.source.x || 0) + (first.target.x || 0)) / 2)
    .attr('y', ((first.source.y || 0) + (first.target.y || 0)) / 2 - 4)
    .text(truncated)
    .transition()
    .duration(350)
    .delay(linkData.length * 55 + 120)
    .ease(d3.easeCubicOut)
    .style('opacity', '1');
}

function shadeColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function blendColors(colors: string[]): string {
  const parsed = colors.map(hex => {
    const num = parseInt(hex.replace('#', ''), 16);
    return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
  });
  const avg = [0, 1, 2].map(i =>
    Math.round(parsed.reduce((sum, c) => sum + c[i], 0) / parsed.length)
  );
  return `#${avg.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
