import { Router } from 'express';
import {
  loadContactsFromFiltered,
  loadExcludedContacts,
  markContactClear,
  markContactNotHuman,
  restoreContact,
} from '../db/queries.js';
import { clearCache } from './graph.js';

const router = Router();

router.get('/contacts', (req, res) => {
  const contacts = loadContactsFromFiltered();
  res.json(contacts.map(c => ({
    name: c.name,
    email: c.email,
    received: c.received_count,
    sent: c.sent_count,
    total: c.total_count,
    not_clear: c.not_clear,
  })));
});

router.get('/excluded-contacts', (req, res) => {
  const excluded = loadExcludedContacts();
  res.json(excluded);
});

router.post('/contacts/mark-clear', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  markContactClear(email);
  clearCache();
  res.json({ success: true, email });
});

router.post('/contacts/mark-not-human', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  markContactNotHuman(email);
  clearCache();
  res.json({ success: true, email });
});

router.post('/contacts/restore', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  const success = restoreContact(email);
  if (!success) {
    return res.status(404).json({ error: 'Contact not found in candidates' });
  }

  clearCache();
  res.json({ success: true, email });
});

export { router as contactsRouter };
