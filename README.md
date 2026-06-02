# Gmail Contact Graph

Visualize your Gmail and Google Calendar communication network as an interactive graph. Parse your Gmail and Calendar exports, extract contacts and co-attendees, and explore them through a D3.js force-directed web interface.

## Dependencies

- **Rust 1.70+** — for the mbox and calendar parsers
- **Node.js 18+** — for the webapp

## Step-by-step setup

### 1. Download your Google data

Go to [Google Takeout](https://takeout.google.com) and export:

- **Mail** → produces a `.mbox` file (required)
- **Calendar** → produces one or more `.ics` files (optional, enables Calendar/Overall/Event Groups views)

### 2. Place the exports in the data directory

Put the `.mbox` file directly in `data/` (default name: `data.mbox`; pass `MBOX_FILE=...` to override).

Put the calendar `.ics` files in `data/Calendar/` (override with `CALENDAR_DIR=...` or `ICS_FILES=...`).

### 3. Parse the mbox and generate databases + rankings

```bash
cd gmail-mbox-parser
make process-all USER_EMAIL=you@gmail.com
```

If your mbox file has a different name than `data.mbox`:

```bash
make process-all USER_EMAIL=you@gmail.com MBOX_FILE=your-export.mbox
```

This runs both `fill-db` (parses the mbox into SQLite databases) and `rankings` (generates contact ranking files). All output goes to `../data/`.

### 3b. (Optional) Parse calendar events

If you exported calendar data, populate the `events` and `event_attendees`
tables in `contacts.db`:

```bash
cd ../calendar-parser
make fill-events USER_EMAIL=you@gmail.com
```

`USER_EMAIL` is required so the parser knows which attendee is "you" when
building the `event_attendees` table. It can also be set in the project-root
`.env`. The parser reads every `.ics` file in `data/Calendar/` by default;
override with `ICS_FILES="a.ics b.ics"` or a different `CALENDAR_DIR`.

#### Optional: AI-powered spam filtering via Hugging Face

Copy the project-root template and fill in your token:

```bash
cp .env.example .env
```

```env
HF_API_KEY=your_huggingface_api_key
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct
```

The same `.env` is also used to set `USER_EMAIL` (so you can drop the
`USER_EMAIL=...` argument from the make commands above) and the webapp's
`USER_NAME` display value.

### 4. Install webapp dependencies

```bash
cd ../gmail-contact-graph
make install
```

The webapp auto-detects calendar data: if the `events` / `event_attendees`
tables exist in `contacts.db`, the Calendar, Overall, and Event Groups filter
modes light up. If you skipped step 3b, only the Gmail and Domains views are
populated.

### 5. Build and run the webapp

```bash
make build
make run
```

Or combine install + build in one step:

```bash
make setup
make run
```

Open [http://localhost:5000](http://localhost:5000).

---

## Output files (in `data/`)

| File | Description |
|---|---|
| `contacts.db` | Extracted contacts with spam filtering, plus `events` and `event_attendees` if calendar parser is run |
| `mails.db` | Parsed email metadata |
| `sent_ranking.txt` | Contacts ranked by emails sent |
| `received_ranking.txt` | Contacts ranked by emails received |
| `sent_per_month_ranking.txt` | Sent emails normalized by relationship duration |
| `received_per_month_ranking.txt` | Received emails normalized by relationship duration |
| `duration_ranking.txt` | Contacts ranked by communication duration |
| `email_length_ranking.txt` | Contacts ranked by average email length |
| `composite_ranking.txt` | Combined score ranking (sent × 1.0 + received × 0.2) |

## Filter modes in the webapp

| Mode | Source | What it shows |
|---|---|---|
| Overall | Gmail + Calendar | Top contacts ranked by combined (Borda-style) score across both sources |
| Gmail | `mails.db` | Email-only contact graph, ranked by composite email score |
| Calendar | `events` + `event_attendees` | Co-attendees from your calendar, ranked by shared meetings |
| Event Groups | `event_attendees` | Mini-star clusters per recurring event / event group |
| Domains | derived | Contacts grouped by email domain |

## Quick reference

| Directory | Command | Description |
|---|---|---|
| `gmail-mbox-parser/` | `make process-all USER_EMAIL=...` | Parse mbox + generate rankings |
| `gmail-mbox-parser/` | `make fill-db USER_EMAIL=...` | Parse mbox only |
| `gmail-mbox-parser/` | `make rankings` | Generate rankings only |
| `calendar-parser/`   | `make fill-events USER_EMAIL=...` | Parse `.ics` files into `events` / `event_attendees` |
| `gmail-contact-graph/` | `make setup` | Install deps + build |
| `gmail-contact-graph/` | `make run` | Start production server (port 5000) |
| `gmail-contact-graph/` | `make dev` | Start dev servers (API:5000, Client:3000) |
