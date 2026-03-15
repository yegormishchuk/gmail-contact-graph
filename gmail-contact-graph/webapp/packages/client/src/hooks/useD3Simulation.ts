import { useEffect, useRef, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphData, GraphNode, DomainGroups, MessageGroups } from '@gmail-graph/shared';
import { graphConfig } from '../utils/graphConfig';
import { getNodeRadius } from '../utils/filterData';

const MIN_MSG_GROUP_SIZE = 3;
const ROPE_MAX_SIZE = 8;

interface RopeLink {
  source: GraphNode;
  target: GraphNode;
}

interface UseD3SimulationOptions {
  svgRef: React.RefObject<SVGSVGElement>;
  data: GraphData | null;
  domains: DomainGroups | null;
  messageGroups: MessageGroups | null;
  selectedNode: GraphNode | null;
  onNodeClick: (node: GraphNode, position: { x: number; y: number }) => void;
}

export function useD3Simulation(options: UseD3SimulationOptions) {
  const simulationRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Refs for group visualization (stable across re-renders)
  const domainLinksGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const groupLinksGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesGroupRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesDataRef = useRef<GraphNode[]>([]);

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
  }, [options.data, options.svgRef, options.onNodeClick, options.domains, options.messageGroups]);

  // Group visualization effect — runs when selected node or data/groups change
  useEffect(() => {
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
    const emailDomain = selectedEmail.split('@')[1];
    const domainUsers = options.domains?.domain_groups?.[emailDomain] ?? [];

    // Message groups: only those containing selected node with >= MIN_MSG_GROUP_SIZE members
    const selectedMsgGroups = Object.entries(options.messageGroups?.groups ?? {})
      .filter(([_, emails]) =>
        emails.map(e => e.toLowerCase()).includes(selectedEmail) &&
        emails.length >= MIN_MSG_GROUP_SIZE
      );

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

      const groupColor = groupIdx === 0
        ? graphConfig.groupColor
        : shadeColor(graphConfig.groupColor, -28 * groupIdx);

      if (memberEmails.length <= ROPE_MAX_SIZE) {
        drawRope(groupLinksGroupRef.current!, memberEmails, nodeMap, groupColor, subject);
      } else {
        memberEmails.filter(e => nodeMap.has(e)).forEach(email => {
          const prev = largeBorderColors.get(email) ?? [];
          largeBorderColors.set(email, [...prev, groupColor]);
        });
      }
    });

    // ── Animate colored borders for large-group members ───────────────────────
    if (largeBorderColors.size > 0) {
      nodesGroupRef.current.selectAll<SVGGElement, GraphNode>('g.node-contact')
        .each(function(d) {
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

    // ── Animate non-members fading out ────────────────────────────────────────
    if (allVisibleMemberEmails.size > 1) {
      nodesGroupRef.current.selectAll<SVGGElement, GraphNode>('g.node-contact')
        .each(function(d) {
          const email = d.email.toLowerCase();
          if (!allVisibleMemberEmails.has(email) && email !== selectedEmail) {
            d3.select(this)
              .transition('opacity').duration(380).ease(d3.easeCubicOut)
              .style('opacity', 0.15);
          }
        });
    }

    // ── Selected node stays fully visible ─────────────────────────────────────
    nodesGroupRef.current.selectAll<SVGGElement, GraphNode>('g.node-contact')
      .filter(d => d.email.toLowerCase() === selectedEmail)
      .transition('opacity').duration(150)
      .style('opacity', 1);

  }, [options.selectedNode, options.data, options.domains, options.messageGroups]);

  return {
    resetZoom,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
