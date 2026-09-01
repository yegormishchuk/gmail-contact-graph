# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until the version reaches 1.0.0, the SQLite schema, the CLI arguments and the
HTTP API may change in a minor release.

## [Unreleased]

## [0.2.1] - 2026-09-01

A documentation release: the Docker chapter now teaches one route instead of
two.

### Removed

- `docker/pipeline.sh`. It only wrapped three `docker compose` commands, and
  being a POSIX script it needed Git Bash on Windows, so the README had to
  document both routes anyway. The Docker chapter now leads with the three
  commands themselves, which run unchanged in PowerShell, Git Bash and a Unix
  shell. Nothing else changes: the parse is still idempotent through
  `.parse-stamp`, and the webapp lock still refuses a parse against a served
  database.

## [0.2.0] - 2026-08-31

Adds a containerised route through the whole pipeline: with Docker installed,
an mbox export becomes a served graph in one command, and no Rust or Node
toolchain has to be present on the host.

### Added

#### Docker

- Two multi-stage images — a parsers image carrying `fill_db`,
  `generate_rankings` and `fill_events`, and a webapp image carrying the built
  Express server and client — plus a `docker-compose.yml` that mounts a host
  data directory into both and puts the parse behind a `parse` profile, so
  `docker compose up` serves an existing database without re-parsing.
- `docker/pipeline.sh` runs the whole thing end to end: parse, rankings,
  calendar, then the webapp on port 5000. `MBOX_FILE`, `USER_EMAIL` and
  `FORCE_REPARSE` pass through from the shell, matching what the Makefiles
  already accepted.
- The parse is idempotent through a `.parse-stamp` recording the inputs it ran
  against, and the stamp is cleared before `fill_db` drops the mails table, so
  a failed parse never leaves a broken database looking current. A lock file
  held by the webapp container keeps a parse from running against a database
  being served, and is released on a crash as well as a clean exit.
- The calendar step is genuinely optional: a missing or empty `Calendar`
  directory is skipped rather than failing the run.
- The webapp healthcheck queries `/api/contacts`, which touches a table, rather
  than a status endpoint that answers 200 over a broken database.

#### Tooling

- CI builds both images on every push and pull request and smoke-tests the
  parse-then-serve path against the committed `sample.mbox` fixture, asserting
  on the contact list the API returns rather than on status codes alone, and
  running the parser twice to prove the stamp skip still works.

#### Documentation

- A Docker chapter in the README covering the fixture demo, a real export,
  rebuilds after a pull, and the Git Bash requirement for `pipeline.sh` on
  Windows.
- Quick start now leads with the Google Takeout request, since the export can
  take hours to arrive, and points at the bundled fixture for anyone who does
  not want to wait. Dependencies get a collapsible per-platform install guide,
  including the `pkg-config` and `libssl-dev` that `openssl-sys` needs on Linux.
- Contributing guidance — no direct pushes to main, Clippy with `-D warnings`,
  Conventional Commits, never commit a real export — plus contact channels and
  a link to the project write-up and its video walkthrough.

### Changed

- The three npm packages and three Rust crates now declare 0.2.0, tracking the
  release tag.

## [0.1.0] - 2026-08-20

First release: the pipeline runs end to end on a clean machine, from a Google
Takeout export to an interactive graph in the browser.

### Added

#### Mail parser — `gmail-mbox-parser`

- `fill_db` reads an mbox export and writes `contacts.db`: a `mails` row per
  recipient, a `contacts` row per correspondent with per-contact metrics (sent,
  received, per-month rates, relationship duration, average message length), and
  `contacts_filtered` listing everyone who survived filtering.
- Header handling for real-world mail: MIME encoded words in base64 and
  quoted-printable, twelve character sets including windows-1251 and KOI8-R,
  folded headers, RFC 2822 dates with malformed variants, and multipart bodies.
- Meeting detection over message bodies — Zoom, Google Meet, Calendly and
  Google Calendar links raise a per-contact counter.
- A heuristic spam filter over six rules: no-reply and automated local parts,
  marketing addresses, one-way correspondents, a blocked-domain list of
  transactional senders, and suspicious display names.
- Optional AI verification of borderline contacts through the Hugging Face
  Inference API, enabled by setting `HF_API_KEY`. See Known limitations.
- `generate_rankings` produces seven ranking files: sent, received, either of
  those normalised per month, relationship duration, average message length, and
  a composite Borda-style combination.

#### Calendar parser — `calendar-parser`

- `fill_events` reads `.ics` exports into the same `contacts.db`, filling
  `events` and `event_attendees`, expanding recurrence rules into individual
  occurrences and linking attendees to existing mail contacts.

#### Webapp — `gmail-contact-graph`

- An Express API over sql.js and a React 18 client rendering a D3
  force-directed graph.
- Five views: Overall (mail and calendar merged into one Borda ranking), Gmail,
  Calendar, Event Groups as mini-star clusters per recurring event, and Domains.
- Per-contact tooltips and a ranking panel that adapt to the active view, plus
  manual review to mark a contact as human or automated.

#### Tooling

- CI runs formatting, Clippy and tests on every push and pull request. The mail
  parser is exercised on Linux, macOS and Windows; the other crates and the
  webapp on Linux.
- A synthetic 19-message mbox under `gmail-mbox-parser/tests/fixtures` drives an
  end-to-end test of the whole parse, and doubles as a way to run the project
  without waiting for a Takeout export.
- Released under Apache-2.0.

### Security

- The API server binds to loopback and sends no wildcard CORS headers, so the
  graph is reachable only from the machine serving it.
- Leaving `HF_API_KEY` blank makes the project issue no outbound network
  requests at all — the whole pipeline runs offline against local files.
- Your mail never leaves the machine. With AI verification enabled, contact
  names and addresses are sent to Hugging Face; subjects and message bodies
  are not.

### Known limitations

- Address parsing has two known defects, both covered by ignored tests in
  `gmail-mbox-parser/src/email.rs`. A display name that itself contains an
  address wins over the real address in angle brackets, and a comma inside a
  quoted display name is read as a recipient separator, dropping the surname.
  Both need a full RFC 5322 parser to fix.
- AI verification is beta and not deterministic: which contacts survive depends
  on the model, and the same model can answer differently between runs.
  Everything else in the pipeline is deterministic.
- Requires Rust 1.87+ and Node.js 20.19+ (or 22+).

[Unreleased]: https://github.com/yegormishchuk/gmail-contact-graph/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/yegormishchuk/gmail-contact-graph/releases/tag/v0.2.1
[0.2.0]: https://github.com/yegormishchuk/gmail-contact-graph/releases/tag/v0.2.0
[0.1.0]: https://github.com/yegormishchuk/gmail-contact-graph/releases/tag/v0.1.0
