# Gmail Contact Graph

[![CI](https://github.com/yegormishchuk/gmail-contact-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/yegormishchuk/gmail-contact-graph/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Visualize your Gmail and Google Calendar communication network as an interactive graph. Parse your Gmail and Calendar exports, extract contacts and co-attendees, and explore them through a D3.js force-directed web interface.

**[See it running →](https://yegormishchuk.dev/blog/gmail_project)** — a write-up
about the project, with a video walkthrough of the graph.

## Privacy

Everything runs on your machine. The parsers read your local Takeout export and
write SQLite files into `data/`; the webapp server binds to `127.0.0.1` only, so
it is reachable from your own machine and not from the rest of your network.
Nothing is uploaded, and `data/` is gitignored so your mail can't be committed
by accident.

The one exception is opt-in. If you set `HF_API_KEY`, contact **names and email
addresses** — never subjects or message bodies — are sent to the Hugging Face
API to classify them as human or automated. Leave `HF_API_KEY` empty and the
project makes no outbound network requests at all.

## Install dependencies

| Dependency | Version | Needed for |
|---|---|---|
| **Rust** | 1.87+ | the mbox and calendar parsers |
| **Node.js** | 20.19+ | the webapp (CI builds on Node 24) |
| **pkg-config** | any | building the parsers — locates system libraries |
| **OpenSSL headers** (`libssl-dev`) | any | building the parsers — TLS for the optional Hugging Face calls |
| **GNU Make** | any | optional — every step below also lists the plain `cargo` / `npm` commands |

`pkg-config` and the OpenSSL development headers are the two that most often
bite: without them `cargo build` fails partway through with a `native-tls` /
`openssl-sys` error rather than a missing-dependency message. They are already
present on macOS (via Homebrew's OpenSSL) and on Windows (the build uses
Schannel), so in practice this is a Linux prerequisite.

<details>
<summary>How to install each one</summary>

**Rust 1.87+** — install via [rustup](https://rustup.rs), which is the same on
every platform:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On Windows, download and run [`rustup-init.exe`](https://rustup.rs) instead.
Already have Rust? Update it:

```bash
rustup update stable
```

Verify with `cargo --version` — it must report 1.87.0 or newer. The version is
declared as `rust-version` in each `Cargo.toml`, so an older toolchain fails
with a clear message instead of a confusing compile error.

**Node.js 20.19+** — download the LTS installer from
[nodejs.org](https://nodejs.org), or use a version manager:

```bash
# nvm (macOS / Linux)
nvm install 24
nvm use 24
```

```bash
# Debian / Ubuntu, via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

```bash
# macOS, via Homebrew
brew install node
```

Verify with `node --version`.

**pkg-config and OpenSSL headers** — needed to compile the parsers' TLS stack:

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y pkg-config libssl-dev build-essential
```

```bash
# Fedora / RHEL
sudo dnf install -y pkgconf-pkg-config openssl-devel gcc
```

```bash
# Arch
sudo pacman -S --needed pkgconf openssl base-devel
```

```bash
# Alpine
sudo apk add pkgconf openssl-dev build-base
```

```bash
# macOS — Xcode command line tools plus Homebrew OpenSSL
xcode-select --install
brew install pkg-config openssl@3
```

On Windows nothing extra is required: the build links against the system
Schannel TLS stack, so there are no OpenSSL headers to install.

**GNU Make** — optional, but every command in this README has a `make` form.

```bash
# Debian / Ubuntu
sudo apt-get install -y make
```

```bash
# macOS — included with the Xcode command line tools
xcode-select --install
```

On Windows, `make` comes with [Git for Windows](https://gitforwindows.org) when
you install the optional Unix tools, or via `choco install make`. If you would
rather not install it, follow the "Without `make`" toggle in each step.

</details>

## Quick start

**Start the download first.** Go to [Google Takeout](https://takeout.google.com)
and request your **Mail** export (and **Calendar**, if you want the calendar
views). It can take hours to arrive, so kick it off before anything else and set
the rest up while you wait. Don't want to wait at all? A synthetic mbox ships
with the parser — jump to [Try it without your own
mail](#try-it-without-your-own-mail) and you can have a graph on screen in a few
minutes.

Then, one line at a time:

```bash
git clone https://github.com/yegormishchuk/gmail-contact-graph.git
```

```bash
cd gmail-contact-graph
```

```bash
cp .env.example .env
```

Open `.env` and set `USER_EMAIL` to your Gmail address.

When the Takeout archive arrives, put the mail export at
`data/Email/data.mbox`, then parse it:

```bash
cd gmail-mbox-parser
```

```bash
make process-all
```

Finally, build and start the webapp:

```bash
cd ../gmail-contact-graph
```

```bash
make setup
```

```bash
make run
```

Open [http://localhost:5000](http://localhost:5000).

## Try it without your own mail

A Takeout export takes hours to arrive. To see the graph before then, build the
databases from the synthetic mbox that ships with the parser — nineteen
invented messages between made-up addresses, no personal data involved:

```bash
cd gmail-mbox-parser
```

```bash
make process-all USER_EMAIL=you@example.com MBOX_DIR=tests/fixtures MBOX_FILE=sample.mbox DATA_DIR=../data/demo
```

```bash
cd ../gmail-contact-graph
```

```bash
make setup
```

```bash
make run CONTACTS_DB_FILE=../data/demo/contacts.db
```

The result is a graph of seven contacts. Everything lands in `data/demo/`, so a
real `data/contacts.db` you have already built is left alone — drop the whole
directory when you are done.

Leave the `HF_API_KEY` line in `.env` empty for this run — the fixture's
invented addresses are exactly the kind of input the classifier judges
unpredictably, and the counts above assume it is switched off. Clearing the
variable in your shell will not help: the parsers read `.env` directly, so the
value there wins.

The same fixture drives the end-to-end test (`cargo test --test e2e`), so it
stays in working order.

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

**Optional: AI-powered spam filtering via Hugging Face — beta.** With
`HF_API_KEY` set, the mbox parser additionally verifies borderline contacts
against a hosted LLM. Set it **now** — it takes effect during step 4, and
enabling it later means re-parsing the whole mbox.

```env
HF_API_KEY=your_huggingface_api_key
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct
HF_BATCH_SIZE=50
HF_TIMEOUT=120
```

> **Beta.** This step is not deterministic. Which contacts survive depends
> entirely on the model you point `HF_MODEL` at, and the same model can return
> different verdicts on different runs — hosted models are also updated and
> retired without notice. Treat the result as a suggestion, not a stable
> classification; the webapp's manual review lets you correct it. Everything
> else in the pipeline is deterministic and unaffected by this setting.

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
└── contacts.db  # shared database, written by both parsers
```

Inputs go in `Calendar/` and `Email/`; everything else is generated.

### Output files

| File | Description |
|---|---|
| `contacts.db` | Extracted contacts with spam filtering, the `mails` table of email metadata, plus `events` and `event_attendees` if calendar parser is run |
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
| Gmail | `mails` + `contacts` | Email-only contact graph, ranked by composite email score |
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
| `gmail-contact-graph/` | `make setup` | Install deps + build |
| `gmail-contact-graph/` | `make run` | Start production server (port 5000) |
| `gmail-contact-graph/` | `make dev` | Start dev servers (API:5000, Client:3000) |

All commands read `USER_EMAIL` from the project-root `.env` (step 3); pass
`USER_EMAIL=...` on the command line to override it for a single run.

## Contributing

Pull requests are welcome. A few things specific to this repository:

**You do not need a mailbox of your own.** The parser ships with a synthetic
19-message mbox in `gmail-mbox-parser/tests/fixtures/`, and `cargo test --test e2e`
runs the entire pipeline against it. To see the result in the browser instead,
follow [Try it without your own mail](#try-it-without-your-own-mail).

**Never commit a real export.** `*.mbox` is gitignored so that a Takeout file
cannot be added by accident. The fixtures directory is the single exception,
and every address in it is invented.

**Run what CI runs, before pushing.** In each of the three crates:

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings   # warnings fail the build
cargo test
```

and for the webapp, from `gmail-contact-graph/webapp`:

```bash
npm run lint && npm run build && npm test
```

**`main` is protected.** Push a branch and open a pull request: direct pushes
are rejected, and all six CI jobs must pass before a merge is possible. No
review approval is required.

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, optionally scoped as
`fix(server): ...`.

**Looking for somewhere to start?** The two address-parsing defects under Known
limitations in [CHANGELOG.md](CHANGELOG.md) each have a failing test waiting in
`gmail-mbox-parser/src/email.rs` — remove the `#[ignore]` and make it pass.

## Contact

- Bugs and ideas — [open an issue](https://github.com/yegormishchuk/gmail-contact-graph/issues)
- Write-up and demo video — [yegormishchuk.dev](https://yegormishchuk.dev/blog/gmail_project)
- Elsewhere — [LinkedIn](https://www.linkedin.com/in/yegor-mishchuk/)

## License

Copyright 2026 Yegor Mishchuk

Licensed under the Apache License, Version 2.0. You may obtain a copy of the
License at <http://www.apache.org/licenses/LICENSE-2.0>. See [LICENSE](LICENSE)
for the full text and [NOTICE](NOTICE) for attribution requirements.
