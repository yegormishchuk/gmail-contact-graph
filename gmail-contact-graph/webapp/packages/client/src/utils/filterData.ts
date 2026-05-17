import type { GraphData, GraphNode } from '@gmail-graph/shared';

interface Filters {
  limit: number;
  filterType: 'overall' | 'gmail' | 'calendar' | 'messageGroups' | 'organizations';
  searchQuery: string;
}

export function filterData(rawData: GraphData, filters: Filters): GraphData {
  let nodes = rawData.nodes.filter(n => !n.isCenter);

  // Sort by composite score
  nodes.sort((a, b) => b.compositeScore - a.compositeScore);

  // Apply contact limit only for non-group filters.
  // Group filters apply their own limit (number of groups) inside useD3Simulation.
  const isGroupFilter = filters.filterType === 'messageGroups' || filters.filterType === 'organizations';
  if (!isGroupFilter) {
    nodes = nodes.slice(0, filters.limit);
  }

  // Add center node back
  const centerNode = rawData.nodes.find(n => n.isCenter);
  if (centerNode) {
    nodes = [centerNode, ...nodes];
  }

  // Filter links to only include visible nodes
  const nodeEmails = new Set(nodes.map(n => n.email));
  nodeEmails.add('me');
  const links = rawData.links.filter(
    l => nodeEmails.has(l.source as string) && nodeEmails.has(l.target as string)
  );

  return {
    nodes,
    links,
    stats: {
      ...rawData.stats,
      displayedContacts: nodes.length - 1, // exclude center
    },
  };
}

export function getNodeRadius(node: GraphNode, maxScore: number): number {
  if (node.isCenter) return 30;
  const minRadius = 11;
  const maxRadius = 30;
  const ratio = maxScore > 0 ? node.compositeScore / maxScore : 0;
  return minRadius + ratio * (maxRadius - minRadius);
}
