# Gmail Contact Graph

Interactive web visualization of your Gmail communication network. Explore contacts through a D3.js force-directed graph.

## Features

- Interactive D3.js force-directed graph visualization
- Contact search and filtering
- Five filter modes: **Overall** (combined Gmail + Calendar ranking), **Gmail**, **Calendar**, **Event Groups**, **Domains**
- Calendar co-attendee graph with per-event-group colored ropes and collapsible mini-star clusters
- Tooltip and ranking panel adapt to the active mode (calendar-specific fields when in Calendar mode, event list per contact, etc.)
- Composite email ranking and Borda-style overall ranking that merges Gmail + Calendar
- Manual contact review (mark as human/not human)

## Prerequisites

- Node.js 20.19+ (CI builds on Node 24)
- `contacts.db` from [gmail-mbox-parser](../gmail-mbox-parser)
- (Optional) `events` / `event_attendees` tables populated by [calendar-parser](../calendar-parser) — enables the Calendar, Overall, and Event Groups views

Setup and the full parse-then-visualize pipeline are documented in the
[project README](../README.md). This file covers the webapp package itself.

## Configuration

Configuration is read from the **project-root `.env`** (`../.env` relative to
this directory) and from process environment variables. The server loads it
on startup via an inline parser in `packages/server/src/config.ts`.

```env
USER_EMAIL=your.email@gmail.com   # "you" node in the graph
USER_NAME=Your Name               # display name (optional; defaults to local-part of USER_EMAIL)
```

The database path defaults to `../data/contacts.db`; override it with
`CONTACTS_DB_FILE`. That one file holds every table the server reads — `mails`,
`contacts`, `contacts_filtered`, and the calendar's `events` and
`event_attendees`. Server port defaults to `5000`; override with `PORT`.

The server binds to `127.0.0.1` and only accepts browser requests from its own
origin, so the graph is not exposed to the rest of your network. Set `HOST` to
override the bind address (for example inside a container) and
`ALLOWED_ORIGINS` to a comma-separated list if you do.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/graph` | GET | Gmail graph data for D3.js |
| `/api/contacts` | GET | All contacts |
| `/api/contacts/all` | GET | Every contact (used by the intro animation) |
| `/api/domains` | GET | Contacts grouped by domain |
| `/api/message-groups` | GET | Multi-recipient emails |
| `/api/excluded-contacts` | GET | Filtered spam/non-human |
| `/api/spam-stats` | GET | Counts for spam-filtering panel |
| `/api/calendar-graph` | GET | Calendar co-attendee graph |
| `/api/calendar-stats` | GET | Calendar summary stats |
| `/api/event-groups` | GET | Recurring-event / event-group clusters |
| `/api/health` | GET | Liveness probe (`{ status: 'ok' }`) |
| `/api/contacts/mark-clear` | POST | Mark contact as human |
| `/api/contacts/mark-not-human` | POST | Remove contact |
| `/api/contacts/restore` | POST | Restore a previously removed contact |

## Commands

```
make setup          Install npm dependencies and build
make install        Install npm dependencies
make build          Build all packages (shared, server, client)
make run            Start production server (port 5000)
make dev            Start dev servers (API 5000, client 3000)
make dev-server     Start API server only
make dev-client     Start React client only
make clean          Remove node_modules and build output
make help           Show all commands
```
