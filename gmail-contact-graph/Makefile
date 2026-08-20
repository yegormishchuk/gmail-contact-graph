# Gmail Contact Graph Webapp - Makefile
# =====================================

# Configuration (USER_EMAIL, PORT, CONTACTS_DB_FILE, ...) is read from the
# project-root .env by packages/server/src/config.ts. Variables set on the make
# command line are exported to the recipes automatically, so
# `make run USER_EMAIL=you@example.com` overrides .env for a single run.

# ============================================
# Main targets
# ============================================

.PHONY: all setup install build run dev dev-server dev-client clean help

all: setup

# ============================================
# Setup targets
# ============================================

setup: install build
	@echo "Setup complete. Run 'make dev' for development or 'make run' for production."

install:
	@echo "Installing dependencies..."
	cd webapp && npm install

build:
	@echo "Building application..."
	cd webapp && npm run build

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
	@echo "    make setup          - Install dependencies and build"
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
	@echo "    USER_EMAIL          - Your Gmail address (the \"you\" node)"
	@echo "    CONTACTS_DB_FILE    - Path to contacts.db"
	@echo "    PORT                - Server port (default: 5000)"
	@echo "    HOST                - Bind address (default: 127.0.0.1)"
	@echo "    ALLOWED_ORIGINS     - Extra CORS origins, comma-separated"
	@echo ""
	@echo "  Example (override email):"
	@echo "    make dev USER_EMAIL=other@example.com"
	@echo ""
	@echo "  Prerequisites:"
	@echo "    - Node.js 20.19+ required"
	@echo "    - Database files in ../data/ (default location)"
