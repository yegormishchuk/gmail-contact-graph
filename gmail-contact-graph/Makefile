# Gmail Contact Graph Webapp - Makefile
# =====================================

# Configuration (USER_EMAIL, PORT, CONTACTS_DB_FILE, ...) is read from the
# project-root .env by packages/server/src/config.ts. Variables set on the make
# command line are exported to the recipes automatically, so
# `make run USER_EMAIL=you@example.com` overrides .env for a single run.

# ============================================
# Main targets
# ============================================

.PHONY: all setup install build build-parsers run dev dev-server dev-client clean help

all: setup

# ============================================
# Setup targets
# ============================================

setup: install build build-parsers
	@echo "Setup complete. Run 'make run' and open http://localhost:5000 to import your mailbox."

install:
	@echo "Installing dependencies..."
	cd webapp && npm install

build:
	@echo "Building application..."
	cd webapp && npm run build

# The webapp runs fill_db and fill_events itself when you import a mailbox from
# the UI. Building them needs Rust; without it this warns instead of failing,
# and the import screen shows the command to run once Rust is installed.
build-parsers:
	@echo "Building the parsers (needs Rust / cargo)..."
	-$(MAKE) -C ../gmail-mbox-parser build-parser
	-$(MAKE) -C ../calendar-parser build
	@echo "If the parser build failed above, the webapp still runs; build them later with this same target."

# ============================================
# Run targets
# ============================================

run:
	@echo "Starting production server..."
	cd webapp && npm run start

dev:
	@echo "Starting development servers..."
	cd webapp && npm run dev

dev-server:
	@echo "Starting API server only..."
	cd webapp && npm run dev:server

dev-client:
	@echo "Starting React client only..."
	cd webapp && npm run dev:client

# ============================================
# Clean targets
# ============================================

clean:
	@echo "Removing node_modules and build artifacts..."
	rm -rf webapp/node_modules
	rm -rf webapp/packages/*/node_modules
	rm -rf webapp/packages/*/dist

# ============================================
# Help
# ============================================

help:
	@echo "Gmail Contact Graph Webapp - Available targets:"
	@echo ""
	@echo "  Setup:"
	@echo "    make setup          - Install dependencies, build, and build the parsers"
	@echo "    make build-parsers  - Build fill_db and fill_events (needs Rust)"
	@echo "    make install        - Install npm dependencies"
	@echo "    make build          - Build all packages"
	@echo ""
	@echo "  Run:"
	@echo "    make run            - Start production server (port 5000)"
	@echo "    make dev            - Start dev servers (API:5000, Client:3000)"
	@echo "    make dev-server     - Start API server only"
	@echo "    make dev-client     - Start React client only"
	@echo ""
	@echo "  Clean:"
	@echo "    make clean          - Remove node_modules and build files"
	@echo ""
	@echo "  Variables (set in ../.env, or override on the command line):"
	@echo "    USER_EMAIL          - Default address on the import screen"
	@echo "    DATA_DIR            - Data directory (default: ../data)"
	@echo "    CONTACTS_DB_FILE    - Path to contacts.db (default: DATA_DIR/contacts.db)"
	@echo "    PORT                - Server port (default: 5000)"
	@echo "    HOST                - Bind address (default: 127.0.0.1)"
	@echo "    ALLOWED_ORIGINS     - Extra CORS origins, comma-separated"
	@echo ""
	@echo "  Example (override email):"
	@echo "    make dev USER_EMAIL=other@example.com"
	@echo ""
	@echo "  Prerequisites:"
	@echo "    - Node.js 20.19+ required"
	@echo "    - Rust 1.87+ to build the parsers the import screen runs"
	@echo "    - A Gmail .mbox export in ../data/Email/"
