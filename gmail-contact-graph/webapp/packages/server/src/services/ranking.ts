import type { ContactFiltered, RankingInfo } from '@gmail-graph/shared';
import { config } from '../config.js';

interface RankingConfig {
  name: string;
  coefficient: number;
}

// Assigns ordinal ranks to contacts by a given metric (descending).
// Contacts with equal values get the same rank; the next distinct value
// skips ranks accordingly (standard competition ranking: 1,1,3,4,...).
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

// Computes a composite score for every contact across all configured metrics.
//
// Algorithm per metric:
//   points = (totalContacts - rank + 1)   — rank 1 gets N pts, last gets 1 pt
//   weightedPoints = points * coefficient
//   compositeScore += weightedPoints
//
// Default metrics (RANKING_CONFIGS):
//   sent     × 1.0  — emails you sent to the contact
//   received × 0.2  — emails you received from the contact
//
// The resulting score is used to size/sort nodes in the graph.
export function calculateCompositeScores(
  contacts: ContactFiltered[]
): Map<string, CompositeScoreData> {
  if (contacts.length === 0) return new Map();

  const totalContacts = contacts.length;
  const scores = new Map<string, CompositeScoreData>();

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
