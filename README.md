# Gmail Contact Graph

Visualize your Gmail and Google Calendar communication network as an interactive graph. Parse your Gmail and Calendar exports, extract contacts and co-attendees, and explore them through a D3.js force-directed web interface.

## Privacy

Everything runs on your machine. The parsers read your local Takeout export and
write SQLite files into `data/`; the webapp serves them from localhost. Nothing
is uploaded, and `data/` is gitignored so your mail can't be committed by
accident.

The one exception is opt-in. If you set `HF_API_KEY`, contact **names and email
addresses** — never subjects or message bodies — are sent to the Hugging Face
API to classify them as human or automated. Leave `HF_API_KEY` empty and the
project makes no outbound network requests at all.

## Dependencies

- **Rust 1.70+** — for the mbox and calendar parsers
- **Node.js 18+** — for the webapp
- **GNU Make** — optional; every step below also lists the plain `cargo` / `npm`
  commands under a "Without `make`" toggle

## Quick start

```bash
git clone <repo-url> gmail-contact-graph
cd gmail-contact-graph
cp .env.example .env                          # set USER_EMAIL

# put your Google Takeout export at data/Email/data.mbox, then:
cd gmail-mbox-parser      && make process-all
cd ../gmail-contact-graph && make setup && make run
```

Open [http://localhost:5000](http://localhost:5000).

## Step-by-step setup

### 1. Download your Google data

Go to [Google Takeout](https://takeout.google.com) and export:

- **Mail** → produces a `.mbox` file (required)
- **Calendar** → produces one or more `.ics` files (optional, enables Calendar/Overall/Event Groups views)

### 2. Place the exports in the data directory

Takeout names the mail export something like `All mail Including Spam and
Trash.mbox`. Put it in `data/Email/` and rename it to `data.mbox`, or keep
the original name and pass `MBOX_FILE="All mail Including Spam and Trash.mbox"`
to the `make` commands below.

Put the calendar `.ics` files in `data/Calendar/` (override with `CALENDAR_DIR=...` or `ICS_FILES=...`).

### 3. Configure `.env`

From the repository root, copy the template and fill it in:

```bash
cp .env.example .env
```

```env
USER_EMAIL=you@gmail.com           # required — identifies "you" in the graph
USER_NAME=Your Name                # optional — display name for your node
HF_API_KEY=                        # optional — see below
```

A single project-root `.env` feeds all three components: both Rust parsers read
it, and so does the webapp server. Setting `USER_EMAIL` here means you can drop
the `USER_EMAIL=...` argument from every `make` command below.

**Optional: AI-powered spam filtering via Hugging Face.** With `HF_API_KEY` set,
the mbox parser additionally verifies borderline contacts against a hosted LLM.
Set it **now** — it takes effect during step 4, and enabling it later means
re-parsing the whole mbox.

```env
HF_API_KEY=your_huggingface_api_key
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct
```

### 4. Parse the mbox and generate databases + rankings

```bash
cd gmail-mbox-parser
make process-all
```

If your mbox file has a different name than `data.mbox`:

```bash
make process-all MBOX_FILE=your-export.mbox
```

This runs both `fill-db` (parses the mbox into SQLite databases) and `rankings` (generates contact ranking files). The databases land in `../data/`, the ranking files in `../data/rankings/`.

<details>
<summary>Without <code>make</code></summary>

```bash
cd gmail-mbox-parser
cargo build --release --bin fill_db
cargo build --release --manifest-path tools/Cargo.toml
./target/release/fill_db ../data/Email/data.mbox ../data/contacts.db
./tools/target/release/generate_rankings ../data/contacts.db ../data/rankings
```

`fill_db` reads `USER_EMAIL` from the project-root `.env`; pass it as an extra
argument (`fill_db <mbox> you@gmail.com <db>`) to override it. On Windows the
binaries are `target\release\fill_db.exe` and
`tools\target\release\generate_rankings.exe`.

</details>

### 5. (Optional) Parse calendar events

If you exported calendar data, populate the `events` and `event_attendees`
tables in `contacts.db`:

```bash
cd ../calendar-parser
make fill-events
```

`USER_EMAIL` (from step 3) is required so the parser knows which attendee is
"you" when building the `event_attendees` table. The parser reads every `.ics`
file in `data/Calendar/` by default; override with `ICS_FILES="a.ics b.ics"` or
a different `CALENDAR_DIR`.

<details>
<summary>Without <code>make</code></summary>

```bash
cd calendar-parser
cargo build --release --bin fill_events
./target/release/fill_events ../data/Calendar --db ../data/contacts.db
```

Add `--user-email you@gmail.com` to override the `.env` value. On Windows the
binary is `target\release\fill_events.exe`.

</details>

### 6. Build and run the webapp

```bash
cd ../gmail-contact-graph
make setup    # install dependencies + build
make run
```

Open [http://localhost:5000](http://localhost:5000).

<details>
<summary>Without <code>make</code></summary>

```bash
cd gmail-contact-graph/webapp
npm install
npm run build
npm start
```

</details>

The webapp auto-detects calendar data: if the `events` / `event_attendees`
tables exist in `contacts.db`, the Calendar, Overall, and Event Groups filter
modes light up. If you skipped step 5, only the Gmail and Domains views are
populated.

---

## The `data/` directory

```
data/
├── Calendar/    # calendar exports: *.ics
├── Email/       # mail exports: *.mbox
├── rankings/    # generated *_ranking.txt files
├── contacts.db  # shared database, written by both parsers
└── mails.db     # email metadata
```

Inputs go in `Calendar/` and `Email/`; everything else is generated.

### Output files

| File | Description |
|---|---|
| `contacts.db` | Extracted contacts with spam filtering, plus `events` and `event_attendees` if calendar parser is run |
| `mails.db` | Parsed email metadata |
| `rankings/sent_ranking.txt` | Contacts ranked by emails sent |
| `rankings/received_ranking.txt` | Contacts ranked by emails received |
| `rankings/sent_per_month_ranking.txt` | Sent emails normalized by relationship duration |
| `rankings/received_per_month_ranking.txt` | Received emails normalized by relationship duration |
| `rankings/duration_ranking.txt` | Contacts ranked by communication duration |
| `rankings/email_length_ranking.txt` | Contacts ranked by average email length |
| `rankings/composite_ranking.txt` | Borda-style combined ranking: rank points from the sent and received rankings, weighted 1.0 and 0.2 |

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
| `gmail-mbox-parser/` | `make process-all` | Parse mbox + generate rankings |
| `gmail-mbox-parser/` | `make fill-db` | Parse mbox only |
| `gmail-mbox-parser/` | `make rankings` | Generate rankings only |
| `calendar-parser/`   | `make fill-events` | Parse `.ics` files into `events` / `event_attendees` |

All commands read `USER_EMAIL` from the project-root `.env` (step 3); pass
`USER_EMAIL=...` on the command line to override it for a single run.
| `gmail-contact-graph/` | `make setup` | Install deps + build |
| `gmail-contact-graph/` | `make run` | Start production server (port 5000) |
| `gmail-contact-graph/` | `make dev` | Start dev servers (API:5000, Client:3000) |

## License

Copyright (C) 2026 Yegor Mishchuk

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. See [LICENSE](LICENSE) for the full text.
