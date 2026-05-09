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

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/gmail-mbox-parser.git
cd gmail-mbox-parser
make build
```

## Usage

### Basic usage

```bash
make fill-db USER_EMAIL=your.email@gmail.com MBOX_FILE=path/to/mail.mbox DATA_DIR=~/gmail-data
```

### With AI verification

Set `HF_API_KEY` (and optionally `HF_MODEL`) in the project-root `.env`
(`../.env`). The same file can supply `USER_EMAIL`, so you can omit it from
the command line. See `../.env.example` for the full set of keys.

```bash
make fill-db MBOX_FILE=path/to/mail.mbox
```

## Output

The parser creates two SQLite databases in `DATA_DIR`:

- `contacts.db` - Contact information with filtering tables
- `mails.db` - Parsed email metadata

### Database schema

**contacts.db:**
- `contacts_candidates` - All extracted contacts
- `contacts_filtered` - Human-verified contacts (spam removed)

**mails.db:**
- Email metadata (subject, date, recipients, etc.)

## Integration

Use with [gmail-contact-graph](https://github.com/YOUR_USERNAME/gmail-contact-graph) webapp to visualize your email network:

```bash
# Run parser
DATA_DIR=~/gmail-data make fill-db USER_EMAIL=you@gmail.com MBOX_FILE=~/mail.mbox

# Run webapp (in gmail-contact-graph repo)
DATA_DIR=~/gmail-data make run
```

## Commands

```
make build          Build parser and tools
make fill-db        Parse mbox and create databases
make rankings       Generate ranking files
make clean          Clean build artifacts
make help           Show all commands
```
