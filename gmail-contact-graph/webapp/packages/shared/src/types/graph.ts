export interface GraphNode {
  id: string;
  name: string;
  email: string;
  isCenter: boolean;
  received: number;
  sent: number;
  compositeScore: number;
  rankings?: RankingInfo[];
  notClear?: boolean;
  // D3 simulation properties (added at runtime)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface RankingInfo {
  name: string;
  rank: number;
  points: number;
}

export interface GraphLink {
  source: string;
  target: string;
  type: 'received' | 'sent';
  count: number;
}

export interface GraphStats {
  totalContacts: number;
  displayedContacts: number;
  totalReceived: number;
  totalSent: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: GraphStats;
}

export interface DomainGroups {
  total_domains: number;
  domain_groups: Record<string, DomainUser[]>;
}

export interface DomainUser {
  name: string;
  email: string;
  received: number;
  sent: number;
  total: number;
}

export interface MessageGroups {
  total_groups: number;
  groups: Record<string, string[]>;
}
