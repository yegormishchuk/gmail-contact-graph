import type {
  GraphData,
  DomainGroups,
  MessageGroups,
  ExcludedContact,
  ApiSuccessResponse,
} from '@gmail-graph/shared';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}

export const api = {
  getGraph: () => fetchJson<GraphData>('/graph'),
  getDomains: () => fetchJson<DomainGroups>('/domains'),
  getMessageGroups: () => fetchJson<MessageGroups>('/message-groups').then(data => {
    console.debug(`[message-groups] found ${data.total_groups} groups`);
    for (const [subject, members] of Object.entries(data.groups)) {
      console.debug(`  subject: ${JSON.stringify(subject)}  members (${members.length}): ${JSON.stringify(members)}`);
    }
    return data;
  }),
  getExcludedContacts: () => fetchJson<ExcludedContact[]>('/excluded-contacts'),

  markClear: (email: string) =>
    fetchJson<ApiSuccessResponse>('/contacts/mark-clear', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  markNotHuman: (email: string) =>
    fetchJson<ApiSuccessResponse>('/contacts/mark-not-human', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  restore: (email: string) =>
    fetchJson<ApiSuccessResponse>('/contacts/restore', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
};
