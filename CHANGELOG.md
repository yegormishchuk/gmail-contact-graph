# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Until the version reaches 1.0.0, the SQLite schema, the CLI arguments and the
HTTP API may change in a minor release.

## [Unreleased]

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

[Unreleased]: https://github.com/yegormishchuk/gmail-contact-graph/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yegormishchuk/gmail-contact-graph/releases/tag/v0.1.0
