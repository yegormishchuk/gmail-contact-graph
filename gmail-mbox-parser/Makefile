# Gmail MBOX Parser - Makefile
# =============================

# Load project-root .env (KEY=VALUE lines) for things like USER_EMAIL.
# Override location with `make ... ENV_FILE=path/to/.env`.
ENV_FILE ?= ../.env
-include $(ENV_FILE)

# Paths
TOOLS_DIR = tools
DATA_DIR ?= ../data
MBOX_DIR ?= $(DATA_DIR)/Email
RANKINGS_DIR ?= $(DATA_DIR)/rankings
MBOX_FILE ?= data.mbox
MBOX_PATH = $(MBOX_DIR)/$(MBOX_FILE)
CONTACTS_DB = $(DATA_DIR)/contacts.db

# User email (required for fill-db). Set on the command line or in $(ENV_FILE).
USER_EMAIL ?=

# Executable extension. Recipes assume a POSIX shell (Git Bash / msys2 on
# Windows), which is what GNU make uses whenever sh is on PATH.
ifeq ($(OS),Windows_NT)
    EXE = .exe
else
    EXE =
endif

# Binaries
FILL_DB = target/release/fill_db$(EXE)
GENERATE_RANKINGS = $(TOOLS_DIR)/target/release/generate_rankings$(EXE)

# ============================================
# Main targets
# ============================================

.PHONY: all build build-parser build-tools help

all: build

build: build-parser build-tools
	@echo "All builds complete."

# ============================================
# Build targets
# ============================================

build-parser:
	@echo "Building parser..."
	cargo build --release --bin fill_db

build-tools:
	@echo "Building ranking tools..."
	cd $(TOOLS_DIR) && cargo build --release

# ============================================
# Database operations
# ============================================

.PHONY: fill-db rankings process-all

fill-db: build-parser
ifeq ($(strip $(USER_EMAIL)),)
	$(error USER_EMAIL is not set. Add USER_EMAIL=you@gmail.com to $(ENV_FILE) or pass it on the command line)
endif
	@echo "Filling database from mbox..."
	@echo "Using email: $(USER_EMAIL)"
	@echo "Reading mbox: $(MBOX_PATH)"
	@echo "Output dir: $(DATA_DIR)"
	@mkdir -p "$(DATA_DIR)"
	$(FILL_DB) "$(MBOX_PATH)" "$(USER_EMAIL)" "$(CONTACTS_DB)"

rankings: build-tools
	@echo "Generating rankings..."
	$(GENERATE_RANKINGS) "$(CONTACTS_DB)" "$(RANKINGS_DIR)"
	@echo "Rankings generated in $(RANKINGS_DIR)/"

process-all: fill-db rankings
	@echo "All processing complete."

# ============================================
# Clean targets
# ============================================

.PHONY: clean clean-data clean-db clean-all

clean:
	@echo "Cleaning build artifacts..."
	cargo clean
	cd $(TOOLS_DIR) && cargo clean

clean-data:
	@echo "Removing generated ranking files..."
	rm -f $(RANKINGS_DIR)/*_ranking.txt

clean-db:
	@echo "Removing database..."
	rm -f $(DATA_DIR)/contacts.db

clean-all: clean clean-data clean-db

# ============================================
# Help
# ============================================

help:
	@echo "Gmail MBOX Parser - Available targets:"
	@echo ""
	@echo "  Build:"
	@echo "    make build          - Build all (parser + tools)"
	@echo "    make build-parser   - Build fill_db binary"
	@echo "    make build-tools    - Build ranking tools"
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
	@echo "    USER_EMAIL          - Your Gmail address (required; can also be set in ../.env)"
	@echo "    ENV_FILE            - Path to .env (default: ../.env)"
	@echo "    MBOX_FILE           - Mbox filename (default: data.mbox, resolved inside MBOX_DIR)"
	@echo "    DATA_DIR            - Data directory (default: ../data)"
	@echo "    MBOX_DIR            - Mbox directory (default: \$$(DATA_DIR)/Email)"
	@echo "    RANKINGS_DIR        - Ranking output dir (default: \$$(DATA_DIR)/rankings)"
	@echo ""
	@echo "  Example:"
	@echo "    make fill-db USER_EMAIL=john@gmail.com MBOX_FILE=gmail_data.mbox"
