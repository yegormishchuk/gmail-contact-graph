import type {
  GraphData,
  DomainGroups,
  MessageGroups,
  ExcludedContact,
  SpamStats,
  ApiSuccessResponse,
  CalendarGraphData,
  CalendarStats,
  EventGroups,
  ImportSources,
  ImportStatus,
  StartImportRequest,
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
    const body = await response.json().catch(() => null);
    if (response.status === 409 && typeof body?.state === 'string' && !body.error) {
      throw new ApiStateError(body.state);
    }
    throw new ApiError(response.status, typeof body?.error === 'string' ? body.error : `API error: ${response.status}`);
  }
  return response.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * A data endpoint answered 409 because there is no database to read yet
 * (state 'empty' or 'importing'). The import status poll decides what to show,
 * so callers loading data can ignore it.
 */
export class ApiStateError extends ApiError {
  constructor(public state: string) {
    super(409, `No data yet (${state})`);
  }
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
  getSpamStats: () => fetchJson<SpamStats>('/spam-stats'),
  getCalendarGraph: () => fetchJson<CalendarGraphData>('/calendar-graph'),
  getCalendarStats: () => fetchJson<CalendarStats>('/calendar-stats'),
  getEventGroups: () => fetchJson<EventGroups>('/event-groups'),
  getAllContacts: () =>
    fetchJson<{ contacts: { name: string; email: string }[]; excludedEmails: string[] }>('/contacts/all'),

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

  getImportStatus: () => fetchJson<ImportStatus>('/import/status'),
  getImportSources: () => fetchJson<ImportSources>('/import/sources'),
  startImport: (request: StartImportRequest) =>
    fetchJson<ImportStatus>('/import', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  cancelImport: () =>
    fetchJson<ImportStatus>('/import/cancel', {
      method: 'POST',
      body: '{}',
    }),
};
