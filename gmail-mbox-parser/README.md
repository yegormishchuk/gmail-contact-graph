# Gmail MBOX Parser

High-performance Rust parser for Gmail MBOX exports. Extracts contacts with spam filtering and optional AI verification.

## Features

- Fast MBOX parsing using memory-mapped files and parallel processing
- Contact extraction with sent/received counts
- Multi-stage spam filtering
- AI-powered human verification via Hugging Face API (optional, beta)
- SQLite output for easy consumption

## Prerequisites

- Rust (1.87+ — declared as `rust-version` in `Cargo.toml`)
- Gmail data export (.mbox file from Google Takeout)
- Hugging Face API key (optional, for AI verification — beta)

Setup and the full parse-then-visualize pipeline are documented in the
[project README](../README.md). This file covers the parser itself.

## Usage

### Basic usage

```bash
make build
make fill-db USER_EMAIL=your.email@gmail.com MBOX_FILE=data.mbox
```

`MBOX_FILE` is a **filename**, not a path — it is resolved inside `MBOX_DIR`
(default `$(DATA_DIR)/Email`, i.e. `../data/Email`). To read an mbox that lives
somewhere else, move the directory rather than the filename:

```bash
make fill-db USER_EMAIL=you@gmail.com MBOX_DIR=~/gmail-data MBOX_FILE=mail.mbox
```

`DATA_DIR` (default `../data`) is the root of the data layout:

```
data/
├── Calendar/    # .ics input for the sibling calendar-parser
├── Email/       # .mbox input          — MBOX_DIR
├── rankings/    # *_ranking.txt output — RANKINGS_DIR
└── contacts.db
```

`MBOX_DIR` and `RANKINGS_DIR` can be overridden independently of `DATA_DIR`.

### With AI verification (beta)

Set `HF_API_KEY` (and optionally `HF_MODEL`) in the project-root `.env`
(`../.env`). The same file can supply `USER_EMAIL`, so you can omit it from
the command line. See `../.env.example` for the full set of keys.

```bash
make fill-db MBOX_FILE=data.mbox
```

> **Beta.** The verification pass is not deterministic. Which contacts are
> classified as human depends entirely on the model `HF_MODEL` names, and the
> same model can return different verdicts on different runs; hosted models are
> also updated and retired without notice. Everything the parser does before
> this pass — mbox parsing, statistics, rule-based spam filtering — is
> deterministic and unaffected.

## Output

The parser creates one SQLite database in `DATA_DIR`, and `make rankings`
writes the `*_ranking.txt` files into `RANKINGS_DIR`:

- `contacts.db` - Every table the webapp reads (and `events` / `event_attendees` once the sibling [calendar-parser](../calendar-parser) is run)

### Database schema

**contacts.db:**
- `mails` - Per-recipient email metadata (subject, date, sender, recipient, content)
- `contacts` - All extracted contacts with their metrics (sent, received, duration, average_chars, meetings, not_spam)
- `contacts_filtered` - Contacts that passed spam filtering: a join table referencing `contacts(id)`, plus a `not_clear` flag

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
