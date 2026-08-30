#!/bin/sh
# The three-step pipeline as one command:
#   stop the webapp -> parse mail + calendar -> start the webapp.
#
# The stop/start bracket is mandatory, not cosmetic: the webapp holds the whole
# database in memory and writes it back wholesale on any exclude-contact action
# (server/src/db/index.ts:30-34), so a webapp left running across a parse
# silently overwrites the fresh database with its stale snapshot.
set -eu
cd "$(dirname "$0")/.."

echo "==> Stopping the webapp (it must not run while the database is rebuilt)"
docker compose stop webapp

echo "==> Parsing mail and calendar"
docker compose --profile parse up --abort-on-container-failure parser calendar

echo "==> Starting the webapp"
docker compose up -d webapp

PORT="${PORT:-5000}"
echo ""
echo "Ready: http://127.0.0.1:${PORT}"
