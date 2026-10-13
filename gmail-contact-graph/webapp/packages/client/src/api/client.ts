import type {
  GraphData,
  DomainGroups,
  MessageGroups,
  ExcludedContact,
  SpamStats,
  ApiSuccessResponse,
  CalendarGraphData,
  CalendarStats,
  DemoReplay,
  EventGroups,
  ImportSources,
  ImportStatus,
  StartImportRequest,
} from '@gmail-graph/shared';
import {
  cancelDemoImport, completedDemoImport, demoStatus, memoryStorage, resetDemoImport, startDemoImport,
  type DemoRun, type DemoStorage,
} from '../demo/demoImport';
import { NO_CALENDAR_STATS, NO_EVENT_GROUPS, withCenterName, withoutCalendar } from '../demo/demoData';

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

// The hosted demo (a server with DEMO_MODE=1, which says so in its import
// status). The server's data is shared and read-only; each visitor's import
// is replayed in the browser (demo/demoImport.ts) and the answers adjusted to
// the name and calendar choice it was made with.

let demoMode = false;
let demoReplay: Promise<DemoReplay> | null = null;
let storage: DemoStorage | null = null;

// The flow still completes if the recorded replay cannot be had.
const FALLBACK_REPLAY: DemoReplay = {
  durationMs: 8000,
  steps: [{ atMs: 0, phase: 'mails', progress: null, detail: '' }],
};

/** Whether the server is the hosted demo; known after the first import status. */
export function isDemo(): boolean {
  return demoMode;
}

/** Forgets this browser's demo imports: back to the empty import screen. */
export function resetDemo(): void {
  resetDemoImport(demoStorage());
}

function replay(): Promise<DemoReplay> {
  demoReplay ??= fetchJson<DemoReplay>('/demo/replay').catch((err) => {
    console.error('Failed to load the demo replay:', err);
    return FALLBACK_REPLAY;
  });
  return demoReplay;
}

// localStorage, unless the browser refuses it (blocked site data, some
// private modes): then the demo lasts as long as the page.
function demoStorage(): DemoStorage {
  if (!storage) {
    try {
      localStorage.setItem('demo_probe', '1');
      localStorage.removeItem('demo_probe');
      storage = localStorage;
    } catch {
      storage = memoryStorage();
    }
  }
  return storage;
}

/** The demo import the data shown comes from; null outside the demo. */
async function demoData(): Promise<DemoRun | null> {
  if (!demoMode) return null;
  return completedDemoImport(demoStorage(), await replay(), Date.now());
}

async function getImportStatus(): Promise<ImportStatus> {
  const status = await fetchJson<ImportStatus>('/import/status');
  if (!status.demo) return status;
  demoMode = true;
  // Only once the server has its data does the visitor's own import count.
  if (status.state !== 'ready') return status;
  return demoStatus(demoStorage(), await replay(), Date.now());
}

async function getGraph(): Promise<GraphData> {
  const [graph, demo] = await Promise.all([fetchJson<GraphData>('/graph'), demoData()]);
  return demo ? withCenterName(graph, demo.name) : graph;
}

async function getCalendarGraph(): Promise<CalendarGraphData> {
  const [graph, demo] = await Promise.all([fetchJson<CalendarGraphData>('/calendar-graph'), demoData()]);
  if (!demo) return graph;
  return withCenterName(demo.includeCalendar ? graph : withoutCalendar(graph), demo.name);
}

async function withoutDemoCalendar<T>(url: string, empty: T): Promise<T> {
  const demo = await demoData();
  return demo && !demo.includeCalendar ? empty : fetchJson<T>(url);
}

export const api = {
  getGraph,
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
  getCalendarGraph,
  getCalendarStats: () => withoutDemoCalendar<CalendarStats>('/calendar-stats', NO_CALENDAR_STATS),
  getEventGroups: () => withoutDemoCalendar<EventGroups>('/event-groups', NO_EVENT_GROUPS),
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

  getImportStatus,
  getImportSources: () => fetchJson<ImportSources>('/import/sources'),
  startImport: async (request: StartImportRequest) => {
    if (demoMode) return startDemoImport(demoStorage(), await replay(), request, Date.now());
    return fetchJson<ImportStatus>('/import', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },
  cancelImport: async () => {
    if (demoMode) return cancelDemoImport(demoStorage(), await replay(), Date.now());
    return fetchJson<ImportStatus>('/import/cancel', {
      method: 'POST',
      body: '{}',
    });
  },
};
