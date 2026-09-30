# Gmail Contact Graph

[![CI](https://github.com/yegormishchuk/gmail-contact-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/yegormishchuk/gmail-contact-graph/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

[Quick start](#quick-start) · [Run without Docker](#run-without-docker) ·
[Using the app](#using-the-app) · [Privacy](#privacy) ·
[Getting your Google data](#getting-your-google-data) ·
[Configuration](#configuration) · [Troubleshooting](#troubleshooting) ·
[Project structure](#project-structure) · [Contributing](#contributing)

Visualize your Gmail and Google Calendar communication network as an
interactive graph. Import your Google Takeout export, and the app extracts
your contacts and meeting co-attendees, filters out spam and automated
senders, and lays everyone out in a D3.js force-directed graph with you at the
centre. Everything runs locally.

**[See it running →](https://yegormishchuk.dev/blog/gmail_project)** — a write-up
about the project, with a video walkthrough of the graph.

## Quick start

See the graph in a few minutes on a synthetic mailbox that ships with the repo
— nineteen invented messages, no personal data involved. All you need is
Docker with Compose v2.27+.

```bash
git clone https://github.com/yegormishchuk/gmail-contact-graph.git
cd gmail-contact-graph
mkdir -p data/Email && cp gmail-mbox-parser/tests/fixtures/sample.mbox data/Email/
docker compose up -d webapp
```

<details>
<summary>PowerShell</summary>

```powershell
git clone https://github.com/yegormishchuk/gmail-contact-graph.git
cd gmail-contact-graph
New-Item -ItemType Directory -Force data/Email
Copy-Item gmail-mbox-parser/tests/fixtures/sample.mbox data/Email/
docker compose up -d webapp
```

</details>

The first start builds the image, which takes several minutes — the parsers
compile SQLite from source. Later starts reuse the cache.

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). On the import screen pick
`sample.mbox`, enter `you@example.com` as your address (every message in the
sample is to or from it), and press **Import**. The result is a graph of seven
contacts.

**Your own mail next.** Request your export now — it can take hours to arrive;
see [Getting your Google data](#getting-your-google-data). When it does, put
the `.mbox` in `data/Email/`, click **Re-import** in the header, pick your file
and enter your own address. The new graph replaces the sample one.

Stop with `docker compose stop webapp`, follow the logs with
`docker compose logs -f webapp`. After a `git pull`, rebuild with
`docker compose up -d --build webapp` — otherwise Compose keeps running the old
image without saying so.

## Run without Docker

Needs **Rust 1.87+** and **Node.js 20.19+**; on Linux also `pkg-config` and the
OpenSSL headers. `make` is optional. Install commands for every platform are in
[docs/install.md](docs/install.md).

```bash
git clone https://github.com/yegormishchuk/gmail-contact-graph.git
cd gmail-contact-graph/gmail-contact-graph
make setup
make run
```

`make setup` installs the webapp's dependencies, builds it, and builds the two
parsers the import screen runs. Open
[http://127.0.0.1:5000](http://127.0.0.1:5000) and import from the screen that
greets you, as in the [Quick start](#quick-start): put the `.mbox` in
`data/Email/` at the repository root, and the calendar `.ics` files, if you
have them, in `data/Calendar/`.

To try it on the sample first, keep it in its own data directory so it never
mixes with your real one:

```bash
mkdir -p ../data/demo/Email && cp ../gmail-mbox-parser/tests/fixtures/sample.mbox ../data/demo/Email/
make run DATA_DIR=../data/demo
```

<details>
<summary>Without <code>make</code></summary>

```bash
cd gmail-mbox-parser && cargo build --release --bin fill_db && cd ..
cd calendar-parser && cargo build --release --bin fill_events && cd ..
cd gmail-contact-graph/webapp
npm install
npm run build
npm start
```

</details>

For development with hot reload, `make dev` starts the API server on port 5000
and the Vite client on 3000.

The parsers can also be run by hand from the command line — for scripting, or
for the ranking `.txt` files. That path is documented separately in
[docs/cli.md](docs/cli.md).

## Using the app

**Importing.** The import screen lists the `.mbox` files in `data/Email/`
(**Refresh list** after adding one), asks for your Gmail address — the centre
of the graph — and optionally your name. If there are `.ics` files in
`data/Calendar/`, the **Calendar** box is ticked and they are imported too. A
mailbox of a gigabyte or so takes a few minutes; the graph opens by itself.
**Re-import** in the header runs it again later, for a newer export, while the
current graph stays up.

**Views.** The filter panel switches what the graph shows:

| Mode | What it shows |
|---|---|
| Overall | Top contacts across mail and calendar, ranked by a combined score |
| Gmail | Email contacts only, ranked by a composite email score |
| Calendar | Meeting co-attendees, ranked by shared meetings |
| Message Groups | People who appear together on the same emails |
| Organizations | Contacts grouped by email domain |
| Event Groups | Clusters per recurring event |

Calendar, Overall and Event Groups need a calendar import; without one only
the mail-based views are populated. **Statistics** in the header summarizes the
mailbox.

**Correcting the filter.** Spam filtering is heuristic, so it gets some
contacts wrong. The 🗑 button next to a contact marks it as not human and
removes it; the **Spam** tab lists everything that was filtered out, with a
**not spam** button to bring a contact back. These edits are kept across a
re-import of the same mailbox.

## Privacy

Everything runs on your machine. The parsers read your local Takeout export and
write SQLite files into `data/`; the webapp server binds to `127.0.0.1` only (and
under Docker, the port is published on `127.0.0.1` only), so it is reachable
from your own machine and not from the rest of your network. Nothing is
uploaded, and `data/` is gitignored so your mail can't be committed by
accident.

The one exception is opt-in. If you set `HF_API_KEY`, contact **names and email
addresses** — never subjects or message bodies — are sent to the Hugging Face
API to classify them as human or automated. Leave `HF_API_KEY` empty and the
project makes no outbound network requests at all.

## Getting your Google data

1. Open [Google Takeout](https://takeout.google.com) and sign in with the
   account you want to graph.
2. Click **Deselect all**, then tick **Mail**. Tick **Calendar** too if you
   want the calendar views.
3. **Next step**. Choose *Send download link via email*, *Export once*, `.zip`,
   and the largest file size, so the mailbox is not split across archives.
4. **Create export**. Google emails you when it is ready — usually within hours,
   sometimes a day or two for a large mailbox.
5. Download and unzip it. The mail is
   `Takeout/Mail/All mail Including Spam and Trash.mbox`; the calendars are
   `.ics` files under `Takeout/Calendar/`.
6. Move the `.mbox` into `data/Email/` and the `.ics` files into
   `data/Calendar/`. Any file name works — you pick the mailbox on the import
   screen.

## Configuration

Nothing is required: the import screen asks for your address. Optional settings
live in one project-root `.env`, copied from the template:

```bash
cp .env.example .env
```

That file is read by the webapp, the parsers and Docker Compose. A value passed
on the `make` command line (`make run PORT=5055`) overrides it.

| Variable | Default | Meaning |
|---|---|---|
| `USER_EMAIL` | — | Your Gmail address, pre-filled on the import screen. |
| `PORT` | `5000` | Server port (under Docker, also the published host port). |
| `HOST` | `127.0.0.1` | Bind address. Loopback keeps your mailbox off the network. |
| `DATA_DIR` | `../data` | Where exports and generated files live. |
| `CONTACTS_DB_FILE` | `$DATA_DIR/contacts.db` | The database the webapp serves and imports into. |
| `MBOX_DIR` | `$DATA_DIR/Email` | Where `.mbox` files are looked for. |
| `CALENDAR_DIR` | `$DATA_DIR/Calendar` | Where `.ics` files are looked for. |
| `FILL_DB_BIN`, `FILL_EVENTS_BIN` | the `target/release` builds | Parser binaries the import screen runs. |
| `ALLOWED_ORIGINS` | empty | Comma-separated origins allowed cross-origin requests; only for a deliberate cross-origin setup. |
| `UID`, `GID` | `1000` | Docker only: owner of the files containers write — see [Troubleshooting](#troubleshooting). |
| `HF_API_KEY`, `HF_MODEL`, `HF_BATCH_SIZE`, `HF_TIMEOUT` | — | The AI spam filter, below. |

Relative paths resolve against `gmail-contact-graph/` for a native run. Under
Docker, `DATA_DIR` is instead the host directory mounted into the container,
relative to the repository root (default `./data`) — so pass a native value on
the command line (`make run DATA_DIR=../data/demo`) rather than putting it in
`.env`. The variables only the command-line parsers use are listed in
[docs/cli.md](docs/cli.md).

### Optional: AI spam filtering via Hugging Face — beta

With `HF_API_KEY` set, the mbox parser additionally verifies borderline contacts
against a hosted LLM (`HF_MODEL`, default `meta-llama/Llama-3.1-8B-Instruct`;
`HF_BATCH_SIZE` contacts per request, `HF_TIMEOUT` seconds per request). It
takes effect during an import, so set it before importing; the import screen
shows whether it is on. Only contact names and email addresses are sent, never
subjects or bodies (see [Privacy](#privacy)).

> **Beta.** This step is not deterministic. Which contacts survive depends
> entirely on the model you point `HF_MODEL` at, and the same model can return
> different verdicts on different runs — hosted models are also updated and
> retired without notice. Treat the result as a suggestion, not a stable
> classification; [the manual corrections](#using-the-app) let you fix it.
> Everything else in the pipeline is deterministic and unaffected by this
> setting.

Leave it empty for the sample mailbox: its invented addresses are exactly the
kind of input the classifier judges unpredictably.

## Troubleshooting

**An import failed.** The graph you had is untouched: an import writes
`contacts.db.new` and swaps it in only on success. The error is shown in the
app; under Docker, `docker compose logs webapp` has the details. The
database from before the last successful import is kept as
`data/contacts.db.prev` for manual recovery.

**The import screen says a parser is not built.** Run `make build-parsers` in
`gmail-contact-graph/` (needs Rust), then **Refresh**. The Docker image always
includes them.

<a id="why-only-one-mbox-at-a-time"></a>**Several `.mbox` files.** An import
reads exactly one mailbox and replaces the previous data, so importing two
files one after the other leaves you with only the second. Import the export
that covers everything — Takeout's *All mail* file.

**No calendar views.** Calendar, Overall and Event Groups stay empty without a
calendar import: put the `.ics` files in `data/Calendar/` and **Re-import**
with the **Calendar** box ticked.

**Docker on Linux or macOS — permission errors in `data/`.** Containers run as
UID 1000 by default. If that is not you, tell Compose your IDs:

```bash
echo "UID=$(id -u)" >> .env && echo "GID=$(id -g)" >> .env
```

**Docker on Windows — slow imports.** `data/` runs to a couple of gigabytes,
and Docker Desktop reaches Windows paths (`C:\...`) through a translation layer
that makes large reads and SQLite noticeably slower. Clone into the WSL2
filesystem (`\\wsl$\...`) rather than working under `/mnt/c/...`.

**Docker is running old code.** `docker compose up` reuses whatever image is
already built. After a `git pull` or a source edit:
`docker compose up -d --build webapp`.

## Project structure

```
gmail-contact-graph/
├── gmail-mbox-parser/     # Rust: fill_db parses an .mbox into SQLite, spam filter,
│                          #       generate_rankings (tools/)
├── calendar-parser/       # Rust: fill_events parses .ics into the same database
├── gmail-contact-graph/   # Node.js webapp
│   └── webapp/packages/
│       ├── shared/        #   TypeScript types
│       ├── server/        #   Express API, runs the parsers on import
│       └── client/        #   React + D3.js graph
├── docker/                # Dockerfiles and entrypoints
├── docs/                  # install guide, command-line pipeline
├── scripts/               # helpers for generating synthetic data
└── data/                  # your exports and the database (gitignored)
```

Inside `data/`:

```
data/
├── Email/            # input: *.mbox
├── Calendar/         # input: *.ics
├── contacts.db       # the database the webapp serves: contacts, mails, events
├── contacts.db.prev  # the database before the last import
├── benchmarks/       # timings.jsonl — how long each stage of each import took
└── rankings/         # *_ranking.txt, written only by the command-line pipeline
```

## Contributing

Pull requests are welcome. A few things specific to this repository:

**You do not need a mailbox of your own.** The parser ships with a synthetic
19-message mbox in `gmail-mbox-parser/tests/fixtures/`, and `cargo test --test e2e`
runs the entire pipeline against it. To see the result in the browser instead,
follow the [Quick start](#quick-start).

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
are rejected, and the six required CI checks (the five `rust` jobs and
`webapp`) must pass; the `docker` job runs too but does not block a merge. No
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
