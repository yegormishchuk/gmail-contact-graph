import type { ContactFiltered, RankingInfo } from '@gmail-graph/shared';
import { config } from '../config.js';

interface RankingConfig {
  name: string;
  coefficient: number;
}

function assignRanks(
  contacts: ContactFiltered[],
  valueFn: (c: ContactFiltered) => number
): Map<string, number> {
  const sorted = [...contacts].sort((a, b) => valueFn(b) - valueFn(a));
  const emailToRank = new Map<string, number>();

  let currentRank = 1;
  let prevValue: number | null = null;
  let sameValueCount = 0;

  for (const contact of sorted) {
    const value = valueFn(contact);
    if (prevValue !== null) {
      if (value === prevValue) {
        sameValueCount++;
      } else {
        currentRank += sameValueCount;
        sameValueCount = 1;
      }
    } else {
      sameValueCount = 1;
    }
    emailToRank.set(contact.email, currentRank);
    prevValue = value;
  }

  return emailToRank;
}

export interface CompositeScoreData {
  score: number;
  rankings: RankingInfo[];
}

export function calculateCompositeScores(
  contacts: ContactFiltered[]
): Map<string, CompositeScoreData> {
  if (contacts.length === 0) return new Map();

  const totalContacts = contacts.length;
  const scores = new Map<string, CompositeScoreData>();

  // Initialize
  for (const c of contacts) {
    scores.set(c.email, { score: 0, rankings: [] });
  }

  const valueFns: Record<string, (c: ContactFiltered) => number> = {
    sent: (c) => c.sent_count,
    received: (c) => c.received_count,
  };

  for (const rankConfig of config.RANKING_CONFIGS) {
    const valueFn = valueFns[rankConfig.name];
    if (!valueFn) continue;

    const ranks = assignRanks(contacts, valueFn);

    for (const [email, rank] of ranks) {
      const data = scores.get(email)!;
      const points = Math.max(0, totalContacts - rank + 1);
      const weightedPoints = points * rankConfig.coefficient;

      data.score += weightedPoints;
      data.rankings.push({
        name: rankConfig.name,
        rank,
        points: weightedPoints,
      });
    }
  }

  return scores;
}
