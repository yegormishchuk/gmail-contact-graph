import { Router } from 'express';
import type { GraphData, GraphNode, GraphLink } from '@gmail-graph/shared';
import { loadContactsFromFiltered } from '../db/queries.js';
import { calculateCompositeScores } from '../services/ranking.js';
import { config } from '../config.js';

const router = Router();

// Cache
let contactsCache: ReturnType<typeof loadContactsFromFiltered> | null = null;
let scoresCache: ReturnType<typeof calculateCompositeScores> | null = null;

export function clearCache() {
  contactsCache = null;
  scoresCache = null;
}

function getContacts() {
  if (!contactsCache) {
    contactsCache = loadContactsFromFiltered();
    scoresCache = calculateCompositeScores(contactsCache);
  }
  return { contacts: contactsCache, scores: scoresCache! };
}

router.get('/graph', (req, res) => {
  const { contacts, scores } = getContacts();

  const nodes: GraphNode[] = [
    {
      id: 'me',
      name: config.MY_NAME,
      email: config.MY_EMAIL,
      isCenter: true,
      received: 0,
      sent: 0,
      compositeScore: 999999999,
    },
  ];

  for (const contact of contacts) {
    const scoreData = scores.get(contact.email) || { score: 0, rankings: [] };
    nodes.push({
      id: contact.email,
      name: contact.name || contact.email.split('@')[0],
      email: contact.email,
      isCenter: false,
      received: contact.received_count,
      sent: contact.sent_count,
      compositeScore: scoreData.score,
      rankings: scoreData.rankings,
      notClear: contact.not_clear,
    });
  }

  const links: GraphLink[] = [];
  for (const contact of contacts) {
    if (contact.received_count > 0) {
      links.push({
        source: contact.email,
        target: 'me',
        type: 'received',
        count: contact.received_count,
      });
    }
    if (contact.sent_count > 0) {
      links.push({
        source: 'me',
        target: contact.email,
        type: 'sent',
        count: contact.sent_count,
      });
    }
  }

  const data: GraphData = {
    nodes,
    links,
    stats: {
      totalContacts: contacts.length,
      displayedContacts: contacts.length,
      totalReceived: contacts.reduce((sum, c) => sum + c.received_count, 0),
      totalSent: contacts.reduce((sum, c) => sum + c.sent_count, 0),
    },
  };

  res.json(data);
});

export { router as graphRouter, getContacts };
