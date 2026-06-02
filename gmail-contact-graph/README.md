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

- Node.js 18+
- `contacts.db` and `mails.db` from [gmail-mbox-parser](../gmail-mbox-parser)
- (Optional) `events` / `event_attendees` tables populated by [calendar-parser](../calendar-parser) — enables the Calendar, Overall, and Event Groups views

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/gmail-contact-graph.git
cd gmail-contact-graph
make setup
```

## Usage

### 1. Generate data with gmail-mbox-parser

First, use the parser to create the databases:

```bash
# In gmail-mbox-parser repo
DATA_DIR=~/gmail-data make fill-db USER_EMAIL=you@gmail.com MBOX_FILE=~/mail.mbox
```

### 2. Run the webapp

```bash
# Point to the same data directory
DATA_DIR=~/gmail-data MY_EMAIL=you@gmail.com MY_NAME="Your Name" make run
```

Open http://localhost:5000

## Configuration

Configuration is read from the **project-root `.env`** (`../.env` relative to
this directory) and from process environment variables. The server loads it
on startup via an inline parser in `packages/server/src/config.ts`.

```env
USER_EMAIL=your.email@gmail.com   # "you" node in the graph
USER_NAME=Your Name               # display name (optional; defaults to local-part of USER_EMAIL)
```

Database paths default to `../data/contacts.db` and `../data/mails.db`;
override with `CONTACTS_DB_FILE` / `MAILS_DB_FILE` if needed. Calendar data
(`events`, `event_attendees`) is read from the same `contacts.db`. Server port
defaults to `5000`; override with `PORT`.

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
| `/api/contacts/mark-clear` | POST | Mark contact as human |
| `/api/contacts/mark-not-human` | POST | Remove contact |
| `/api/contacts/restore` | POST | Restore a previously removed contact |

## Commands

```
make setup          Create virtual environment
make run            Start web application
make run-dev        Start in development mode
make clean          Remove venv and cache
make help           Show all commands
```
