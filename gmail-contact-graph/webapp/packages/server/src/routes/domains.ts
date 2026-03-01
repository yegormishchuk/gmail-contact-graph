import { Router } from 'express';
import { groupContactsByDomain } from '../db/queries.js';
import { getContacts } from './graph.js';

const router = Router();

router.get('/domains', (req, res) => {
  const { contacts } = getContacts();
  const domainGroups = groupContactsByDomain(contacts);

  const result: Record<string, Array<{
    name: string;
    email: string;
    received: number;
    sent: number;
    total: number;
  }>> = {};

  for (const [domain, users] of Object.entries(domainGroups)) {
    result[domain] = users
      .map(c => ({
        name: c.name,
        email: c.email,
        received: c.received_count,
        sent: c.sent_count,
        total: c.total_count,
      }))
      .sort((a, b) => b.total - a.total);
  }

  res.json({
    total_domains: Object.keys(result).length,
    domain_groups: result,
  });
});

export { router as domainsRouter };
