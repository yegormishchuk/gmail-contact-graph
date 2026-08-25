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
    echo "  ./docker/pipeline.sh" >&2
    echo "or: docker compose --profile parse up --abort-on-container-failure parser calendar" >&2
    exit 1
fi

cleanup() { rm -f "$LOCK"; }
trap 'cleanup; [ -n "${pid:-}" ] && kill -TERM "$pid" 2>/dev/null; exit 0' TERM INT

echo "$$" > "$LOCK"
node dist/index.js &
pid=$!
wait "$pid"
status=$?
cleanup
exit "$status"
