#!/bin/sh
# Container-side equivalent of the `fill-db`, `rankings` and `fill-events` make
# targets. Variable names and defaults deliberately mirror
# gmail-mbox-parser/Makefile and calendar-parser/Makefile -- if you change a
# default there, change it here too.
#
# Usage: parse-entrypoint.sh mail|calendar
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
MBOX_DIR="${MBOX_DIR:-$DATA_DIR/Email}"
MBOX_FILE="${MBOX_FILE:-data.mbox}"
RANKINGS_DIR="${RANKINGS_DIR:-$DATA_DIR/rankings}"
DB_PATH="${DB_PATH:-$DATA_DIR/contacts.db}"
ICS_FILES="${ICS_FILES:-$DATA_DIR/Calendar}"
STAMP="$DATA_DIR/.parse-stamp"
LOCK="$DATA_DIR/.webapp.lock"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -n "${USER_EMAIL:-}" ] || die "USER_EMAIL is not set.
Copy .env.example to .env in the project root and fill in USER_EMAIL,
or pass it on the command line: USER_EMAIL=you@gmail.com docker compose ..."

[ -d "$DATA_DIR" ] || die "$DATA_DIR is not mounted."

# The webapp reads contacts.db into memory once at startup and writes the WHOLE
# file back on every exclude-contact action (server/src/db/index.ts:30-34).
# A webapp started before this parse would silently overwrite the fresh
# database with its stale snapshot.
if [ -e "$LOCK" ]; then
    die "the webapp container is running and would overwrite this parse.
Stop it first:  docker compose stop webapp
(If a hard-killed container left the lock behind, delete $LOCK.)"
fi

mkdir -p "$RANKINGS_DIR"

case "${1:-}" in
  mail)
    MBOX_PATH="$MBOX_DIR/$MBOX_FILE"
    if [ ! -f "$MBOX_PATH" ]; then
        echo "ERROR: mbox not found: $MBOX_PATH" >&2
        echo "MBOX_FILE=$MBOX_FILE. Files present in $MBOX_DIR:" >&2
        ls -1 "$MBOX_DIR" >&2 2>/dev/null || echo "  (directory is empty or missing)" >&2
        echo "Set MBOX_FILE in .env to one of them." >&2
        # fill_db takes exactly ONE mbox and starts with DROP TABLE IF EXISTS
        # mails (fill_db/db.rs:23), so looping over *.mbox would silently keep
        # only the last file. One file per run, on purpose.
        exit 1
    fi

    # Idempotency stamp. NOT "does contacts.db exist": that skips forever after
    # a crash mid-parse, ignores a freshly exported mbox, and clashes with the
    # hand-restored contacts.db.bak files already in data/. Signature is
    # name+size+mtime+email -- sha256 of a 2.7 GB mbox would cost 10-60s on
    # every start, including no-op ones.
    SIG="$MBOX_FILE $(stat -c '%s %Y' "$MBOX_PATH") $USER_EMAIL"
    if [ "${FORCE_REPARSE:-0}" != "1" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$SIG" ]; then
        echo "Database is up to date for $MBOX_FILE -- skipping. FORCE_REPARSE=1 to override."
        exit 0
    fi

    # Drop the stamp BEFORE the first destructive step. fill_db starts with
    # DROP TABLE IF EXISTS mails (fill_db/db.rs:23), so from here on the
    # database on disk is incomplete until the run finishes. A stamp left in
    # place would survive a failure and -- if it happened to match this same
    # signature from an earlier successful run -- make the next run report
    # "up to date" and start the webapp on a half-built database.
    rm -f "$STAMP"

    echo "Parsing $MBOX_PATH as $USER_EMAIL -> $DB_PATH"
    fill_db "$MBOX_PATH" "$USER_EMAIL" "$DB_PATH"
    echo "Generating rankings -> $RANKINGS_DIR"
    generate_rankings "$DB_PATH" "$RANKINGS_DIR"

    # Written only after every step succeeded. `set -eu` above is what makes
    # that true: without it a failing fill_db would be ignored, the script
    # would exit 0, and compose would report service_completed_successfully.
    printf '%s' "$SIG" > "$STAMP"
    echo "Done."
    ;;

  calendar)
    [ -f "$DB_PATH" ] || die "$DB_PATH does not exist. Run the mail parser first."

    # The calendar step is optional (README: "5. (Optional) Parse calendar
    # events"), so an empty or absent Calendar directory is a skip, not a
    # failure. fill_events itself exits 1 in that case, which would abort the
    # whole pipeline for everyone who never exported a calendar.
    # Absent counts as empty: a fresh DATA_DIR has no Calendar directory at
    # all, and requiring -d here made that case fall through to fill_events,
    # which exits 1 and aborts the pipeline before the webapp ever starts.
    if [ ! -d "$ICS_FILES" ] || [ -z "$(find "$ICS_FILES" -maxdepth 1 -iname '*.ics' -print -quit)" ]; then
        echo "No .ics files in $ICS_FILES -- skipping the calendar step."
        echo "Export Google Calendar into that directory to enable the calendar views."
        exit 0
    fi

    echo "Filling events from $ICS_FILES -> $DB_PATH"
    # fill_events accepts a directory, unlike fill_db.
    fill_events "$ICS_FILES" --db "$DB_PATH" --user-email "$USER_EMAIL"
    echo "Done."
    ;;

  *)
    die "usage: parse-entrypoint.sh mail|calendar (got '${1:-}')"
    ;;
esac
