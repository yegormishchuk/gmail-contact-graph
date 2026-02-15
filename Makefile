# Gmail Contact Graph - Makefile
# ==============================

# Paths
RUST_PARSER_DIR = rust_parser
TOOLS_DIR = rust_parser/tools
DATA_DIR = data
MBOX_FILE ?= $(DATA_DIR)/gmail_data.mbox
CONTACTS_DB = $(DATA_DIR)/contacts.db

# User email (set via environment or override)
USER_EMAIL ?= your_email@example.com

# Python
PYTHON ?= python
VENV_DIR = venv

# Detect OS for executable extension and venv activation
ifeq ($(OS),Windows_NT)
    EXE = .exe
    VENV_ACTIVATE = $(VENV_DIR)\Scripts\activate
    VENV_PYTHON = $(VENV_DIR)\Scripts\python
else
    EXE =
    VENV_ACTIVATE = $(VENV_DIR)/bin/activate
    VENV_PYTHON = $(VENV_DIR)/bin/python
endif

# Binaries
FILL_DB = $(RUST_PARSER_DIR)/target/release/fill_db$(EXE)
GENERATE_RANKINGS = $(TOOLS_DIR)/target/release/generate_rankings$(EXE)

# ============================================
# Main targets
# ============================================

.PHONY: all build build-parser build-tools clean help setup run

all: build

build: build-parser build-tools
	@echo "All builds complete."

# ============================================
# Setup targets
# ============================================

setup: venv build
	@echo "Setup complete. Activate venv and run 'make run' to start."

venv:
	@echo "Creating Python virtual environment..."
	$(PYTHON) -m venv $(VENV_DIR)
	$(VENV_PYTHON) -m pip install --upgrade pip
	$(VENV_PYTHON) -m pip install -r requirements.txt
	@echo "Virtual environment ready. Activate with:"
	@echo "  Windows: $(VENV_DIR)\\Scripts\\activate"
	@echo "  Linux/macOS: source $(VENV_DIR)/bin/activate"

# ============================================
# Run targets
# ============================================

run:
	@echo "Starting web application..."
	$(VENV_PYTHON) webapp/app.py

# ============================================
# Build targets
# ============================================

build-parser:
	@echo "Building rust_parser..."
	cd $(RUST_PARSER_DIR) && cargo build --release --bin fill_db

build-tools:
	@echo "Building ranking tools..."
	cd $(TOOLS_DIR) && cargo build --release

# ============================================
# Database operations
# ============================================

.PHONY: fill-db rankings

fill-db: build-parser
	@echo "Filling database from mbox..."
	@echo "Using email: $(USER_EMAIL)"
	$(FILL_DB) "$(MBOX_FILE)" "$(USER_EMAIL)" "$(CONTACTS_DB)"

rankings: build-tools
	@echo "Generating rankings..."
	$(GENERATE_RANKINGS) "$(CONTACTS_DB)" "$(DATA_DIR)"
	@echo "Rankings generated in $(DATA_DIR)/"

# ============================================
# Combined operations
# ============================================

.PHONY: process-all

process-all: fill-db rankings
	@echo "All processing complete."

# ============================================
# Clean targets
# ============================================

clean:
	@echo "Cleaning build artifacts..."
	cd $(RUST_PARSER_DIR) && cargo clean
	cd $(TOOLS_DIR) && cargo clean

clean-data:
	@echo "Removing generated ranking files..."
	rm -f $(DATA_DIR)/sent_ranking.txt
	rm -f $(DATA_DIR)/sent_per_month_ranking.txt
	rm -f $(DATA_DIR)/received_ranking.txt
	rm -f $(DATA_DIR)/received_per_month_ranking.txt
	rm -f $(DATA_DIR)/duration_ranking.txt
	rm -f $(DATA_DIR)/email_length_ranking.txt

clean-db:
	@echo "Removing database..."
	rm -f $(CONTACTS_DB)

clean-all: clean clean-data clean-db

# ============================================
# Help
# ============================================

help:
	@echo "Gmail Contact Graph - Available targets:"
	@echo ""
	@echo "  Setup:"
	@echo "    make setup          - Full setup (venv + build)"
	@echo "    make venv           - Create Python virtual environment"
	@echo ""
	@echo "  Build:"
	@echo "    make build          - Build all (parser + tools)"
	@echo "    make build-parser   - Build rust_parser (fill_db)"
	@echo "    make build-tools    - Build ranking tools"
	@echo ""
	@echo "  Run:"
	@echo "    make run            - Start the web application"
	@echo ""
	@echo "  Data processing:"
	@echo "    make fill-db        - Parse mbox and fill databases"
	@echo "    make rankings       - Generate ranking files"
	@echo "    make process-all    - Run fill-db + rankings"
	@echo ""
	@echo "  Clean:"
	@echo "    make clean          - Clean build artifacts"
	@echo "    make clean-data     - Remove ranking files"
	@echo "    make clean-db       - Remove databases"
	@echo "    make clean-all      - Clean everything"
	@echo ""
	@echo "  Variables:"
	@echo "    USER_EMAIL          - Your Gmail address (required for fill-db)"
	@echo "    MBOX_FILE           - Path to mbox file (default: data/mail.mbox)"
	@echo ""
	@echo "  Example:"
	@echo "    make setup"
	@echo "    make fill-db USER_EMAIL=john@gmail.com MBOX_FILE=path/to/mail.mbox"
	@echo "    make run"
