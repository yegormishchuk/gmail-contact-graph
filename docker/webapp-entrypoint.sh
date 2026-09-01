#!/bin/sh
# Holds /app/data/.webapp.lock for as long as the server runs, so the parser
# entrypoint can refuse to overwrite the database underneath a live webapp
# (see docker/parse-entrypoint.sh and server/src/db/index.ts:30-34).
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
LOCK="$DATA_DIR/.webapp.lock"

if [ -z "${USER_EMAIL:-}" ]; then
    echo "ERROR: USER_EMAIL is not set." >&2
    echo "Copy .env.example to .env in the project root and fill in USER_EMAIL." >&2
    exit 1
fi

DB_FILE="${CONTACTS_DB_FILE:-$DATA_DIR/contacts.db}"
if [ ! -f "$DB_FILE" ]; then
    echo "ERROR: $DB_FILE not found. Run the parsers first:" >&2
    echo "  docker compose --profile parse up --abort-on-container-failure parser calendar" >&2
    exit 1
fi

cleanup() { rm -f "$LOCK"; }
# EXIT, not just the end of the script: under `set -e` a server that dies with
# a non-zero status aborts the script at the `wait` below, and a cleanup call
# placed after it would never run. The lock left behind then makes every later
# parse refuse with "the webapp container is running" when nothing is.
trap cleanup EXIT
# cleanup again here rather than relying on the EXIT trap: whether a shell runs
# its EXIT trap on the way out of a signal handler varies between shells, and
# rm -f twice costs nothing.
trap 'cleanup; [ -n "${pid:-}" ] && kill -TERM "$pid" 2>/dev/null; exit 0' TERM INT

echo "$$" > "$LOCK"
node dist/index.js &
pid=$!
# `|| status=$?` keeps `set -e` from swallowing the exit status here; the EXIT
# trap releases the lock either way.
status=0
wait "$pid" || status=$?
exit "$status"
