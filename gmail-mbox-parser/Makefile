# Gmail MBOX Parser - Makefile
# =============================

# Paths
TOOLS_DIR = tools
DATA_DIR ?= data
MBOX_FILE ?= $(DATA_DIR)/mail.mbox
CONTACTS_DB = $(DATA_DIR)/contacts.db

# User email (required for fill-db)
USER_EMAIL ?= your_email@example.com

# Detect OS for executable extension
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

.PHONY: all build build-parser build-tools clean help

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
	@echo "Filling database from mbox..."
	@echo "Using email: $(USER_EMAIL)"
	@echo "Output dir: $(DATA_DIR)"
	@mkdir -p $(DATA_DIR)
	$(FILL_DB) "$(MBOX_FILE)" "$(USER_EMAIL)" "$(CONTACTS_DB)"

rankings: build-tools
	@echo "Generating rankings..."
	$(GENERATE_RANKINGS) "$(CONTACTS_DB)" "$(DATA_DIR)"
	@echo "Rankings generated in $(DATA_DIR)/"

process-all: fill-db rankings
	@echo "All processing complete."

# ============================================
# Clean targets
# ============================================

clean:
	@echo "Cleaning build artifacts..."
	cargo clean
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
	@echo "Removing databases..."
	rm -f $(DATA_DIR)/contacts.db
	rm -f $(DATA_DIR)/mails.db

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
	@echo "    USER_EMAIL          - Your Gmail address (required)"
	@echo "    MBOX_FILE           - Path to mbox file (default: data/mail.mbox)"
	@echo "    DATA_DIR            - Output directory (default: data)"
	@echo ""
	@echo "  Example:"
	@echo "    make fill-db USER_EMAIL=john@gmail.com MBOX_FILE=~/takeout/mail.mbox DATA_DIR=~/gmail-data"
