# Gmail MBOX Parser

High-performance Rust parser for Gmail MBOX exports. Extracts contacts with spam filtering and optional AI verification.

## Features

- Fast MBOX parsing using memory-mapped files and parallel processing
- Contact extraction with sent/received counts
- Multi-stage spam filtering
- AI-powered human verification via Hugging Face API (optional)
- SQLite output for easy consumption

## Prerequisites

- Rust (1.70+)
- Gmail data export (.mbox file from Google Takeout)
- Hugging Face API key (optional, for AI verification)

Setup and the full parse-then-visualize pipeline are documented in the
[project README](../README.md). This file covers the parser itself.

## Usage

### Basic usage

```bash
make build
make fill-db USER_EMAIL=your.email@gmail.com MBOX_FILE=data.mbox
```

`MBOX_FILE` is a **filename**, not a path — it is resolved inside `DATA_DIR`
(default `../data`). To read an mbox that lives somewhere else, move the
directory rather than the filename:

```bash
make fill-db USER_EMAIL=you@gmail.com DATA_DIR=~/gmail-data MBOX_FILE=mail.mbox
```

`DATA_DIR` is also where the databases and ranking files are written.

### With AI verification

Set `HF_API_KEY` (and optionally `HF_MODEL`) in the project-root `.env`
(`../.env`). The same file can supply `USER_EMAIL`, so you can omit it from
the command line. See `../.env.example` for the full set of keys.

```bash
make fill-db MBOX_FILE=data.mbox
```

## Output

The parser creates two SQLite databases in `DATA_DIR`:

- `contacts.db` - Contact information with filtering tables (and `events` / `event_attendees` once the sibling [calendar-parser](../calendar-parser) is run)
- `mails.db` - Parsed email metadata

### Database schema

**contacts.db:**
- `contacts_candidates` - All extracted contacts
- `contacts_filtered` - Human-verified contacts (spam removed)

**mails.db:**
- Email metadata (subject, date, recipients, etc.)

## Companion: calendar-parser

For Google Calendar coverage in the webapp (Calendar / Overall / Event Groups
views), run the sibling [`calendar-parser`](../calendar-parser) crate after
`fill-db`. It populates the `events` and `event_attendees` tables in the same
`contacts.db`:

```bash
cd ../calendar-parser
make fill-events USER_EMAIL=you@gmail.com
```

## Commands

```
make build          Build parser and tools
make fill-db        Parse mbox and create databases
make rankings       Generate ranking files
make process-all    Run fill-db + rankings
make clean          Clean build artifacts
make clean-data     Remove generated ranking files
make clean-db       Remove databases
make help           Show all commands
```
