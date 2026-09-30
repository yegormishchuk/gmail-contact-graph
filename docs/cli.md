# Command-line pipeline

Importing from the webapp is the supported way to build the graph — see the
[README](../README.md). The parsers still run on their own from the command
line, which is useful for scripting and development, and it is the only way to
get the ranking `.txt` files. It builds the same `data/contacts.db`.

All settings come from the project-root `.env` — see
[Configuration](../README.md#configuration). Unlike the webapp, the command-line
parsers **require** `USER_EMAIL`, either in `.env` or on the `make` command line.

## Don't parse while the webapp is running

This is about the command-line parse only, native or Docker. **Re-import** in
the webapp is safe at any time: the server writes the new data to a separate
file and swaps it in itself.

The webapp loads the whole database into memory at startup, and every time you
exclude a contact it writes that in-memory copy back over the file. A webapp
that started *before* a parse will therefore overwrite the freshly parsed
database with its stale copy — silently, at the moment you next click something.

So stop the webapp first (Ctrl+C on `make run`, or `docker compose stop webapp`),
parse, then start it again. Under Docker this is enforced: run the parser while
the webapp container is up and it refuses:

```
ERROR: the webapp container is running and would overwrite this parse.
Stop it first:  docker compose stop webapp
```

## Native

### 1. Place the exports

Takeout names the mail export something like `All mail Including Spam and
Trash.mbox`. Put it in `data/Email/` and rename it to `data.mbox`, or keep
the original name and pass `MBOX_FILE="All mail Including Spam and Trash.mbox"`
to the `make` commands below. The parser reads exactly one file — see [Why only
one mbox at a time](../README.md#why-only-one-mbox-at-a-time).

Put the calendar `.ics` files in `data/Calendar/` (override with
`CALENDAR_DIR=...` or `ICS_FILES=...`).

### 2. Parse the mbox and generate the database + rankings

```bash
cd gmail-mbox-parser
make process-all
```

If your mbox file has a different name than `data.mbox`:

```bash
make process-all MBOX_FILE=your-export.mbox
```

This runs both `fill-db` (parses the mbox into the SQLite database) and
`rankings` (generates contact ranking files). The database lands in
`../data/contacts.db`, the ranking files in `../data/rankings/`.

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

### 3. (Optional) Parse calendar events

Populates the `events` and `event_attendees` tables in `contacts.db`:

```bash
cd ../calendar-parser
make fill-events
```

`USER_EMAIL` is required so the parser knows which attendee is "you". The
parser reads every `.ics` file in `data/Calendar/` by default; override with
`ICS_FILES="a.ics b.ics"` or a different `CALENDAR_DIR`.

<details>
<summary>Without <code>make</code></summary>

```bash
cd ../calendar-parser
cargo build --release --bin fill_events
./target/release/fill_events ../data/Calendar --db ../data/contacts.db
```

Add `--user-email you@gmail.com` to override the `.env` value. On Windows the
binary is `target\release\fill_events.exe`.

</details>

### 4. Start the webapp

```bash
cd ../gmail-contact-graph
make setup
make run
```

It opens on the graph just built. A webapp that was already running keeps
serving the old graph until it is restarted — it reads a database it did not
import itself only at startup.

### On the synthetic sample

```bash
cd gmail-mbox-parser
make process-all USER_EMAIL=you@example.com MBOX_DIR=tests/fixtures MBOX_FILE=sample.mbox DATA_DIR=../data/demo
cd ../gmail-contact-graph
make run CONTACTS_DB_FILE=../data/demo/contacts.db
```

Leave `HF_API_KEY` empty in `.env` for this: the parsers read `.env` directly,
so clearing the variable in your shell does not help.

## Docker

The parsers also run as one-shot Compose services behind the `parse` profile.
They read one mbox, `MBOX_FILE` (default `data.mbox`), and need `USER_EMAIL`
in `.env`. Three commands, in this order:

```bash
docker compose stop webapp
```

```bash
docker compose --profile parse up --abort-on-container-failure parser calendar
```

```bash
docker compose up -d webapp
```

None of the three steps is cosmetic. The webapp is stopped first because of
[the rule above](#dont-parse-while-the-webapp-is-running). Naming
`parser calendar` explicitly matters as well: `docker compose --profile parse
up` without service names would also start the webapp. And
`--abort-on-container-failure` is what makes `up` exit non-zero when a one-shot
service fails; without it a failed parse looks like a successful run.

If nothing changed since the last run, the parser says so and skips the slow
part; `FORCE_REPARSE=1` in the environment re-parses anyway. To re-import only
the calendar, put `calendar` alone in the middle command — the mail parser
still starts, because the calendar step depends on it, but finds the database
up to date and exits immediately.

Use `--profile parse` on `down` as well: a plain `docker compose down` only
touches the default profile, so stopped parser containers stay listed in
`docker compose ps -a`.

<details>
<summary>On the synthetic sample</summary>

```bash
mkdir -p data/demo/Email && cp gmail-mbox-parser/tests/fixtures/sample.mbox data/demo/Email/
export USER_EMAIL=you@example.com MBOX_FILE=sample.mbox DATA_DIR=./data/demo
docker compose --profile parse up --abort-on-container-failure parser
docker compose up -d webapp
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force data/demo/Email
Copy-Item gmail-mbox-parser/tests/fixtures/sample.mbox data/demo/Email/
$env:USER_EMAIL = "you@example.com"; $env:MBOX_FILE = "sample.mbox"; $env:DATA_DIR = "./data/demo"
docker compose --profile parse up --abort-on-container-failure parser
docker compose up -d webapp
```

The fixture goes under `data/demo/Email/` because `DATA_DIR` is what gets
mounted: the parser always reads `$DATA_DIR/Email/$MBOX_FILE`.

To run it next to a stack already serving your real mail, give it its own
Compose project and port — `-p gcg-fixture` and `PORT=5055` — and repeat
`-p gcg-fixture` on every command of that run, `down` included.

</details>

## Ranking files

`make rankings` (part of `make process-all`) writes these to `data/rankings/`:

| File | Description |
|---|---|
| `sent_ranking.txt` | Contacts ranked by emails sent |
| `received_ranking.txt` | Contacts ranked by emails received |
| `sent_per_month_ranking.txt` | Sent emails normalized by relationship duration |
| `received_per_month_ranking.txt` | Received emails normalized by relationship duration |
| `duration_ranking.txt` | Contacts ranked by communication duration |
| `email_length_ranking.txt` | Contacts ranked by average email length |
| `composite_ranking.txt` | Borda-style combined ranking: rank points from the sent and received rankings, weighted 1.0 and 0.2 |

## Command reference

| Directory | Command | Description |
|---|---|---|
| `gmail-mbox-parser/` | `make process-all` | Parse mbox + generate rankings |
| `gmail-mbox-parser/` | `make fill-db` | Parse mbox only |
| `gmail-mbox-parser/` | `make rankings` | Generate rankings only |
| `gmail-mbox-parser/` | `make build` | Build `fill_db` and the ranking tool |
| `gmail-mbox-parser/` | `make clean` / `clean-data` / `clean-db` / `clean-all` | Remove build artifacts / ranking files / `contacts.db` / all three |
| `calendar-parser/`   | `make fill-events` | Parse `.ics` files into `events` / `event_attendees` |
| `calendar-parser/`   | `make build` / `make clean` | Build / remove `fill_events` |

Every Makefile also has `make help`.
