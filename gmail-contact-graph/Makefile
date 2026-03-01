# Gmail Contact Graph Webapp - Makefile
# =====================================

# ============================================
# Main targets
# ============================================

.PHONY: all setup install build run dev clean help

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
	rm -f webapp/package-lock.json

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
	@echo "  Environment variables (optional):"
	@echo "    CONTACTS_DB_FILE    - Path to contacts.db"
	@echo "    MAILS_DB_FILE       - Path to mails.db"
	@echo "    PORT                - Server port (default: 5000)"
	@echo ""
	@echo "  Prerequisites:"
	@echo "    - Node.js 18+ required"
	@echo "    - Database files in ../data/ (default location)"
