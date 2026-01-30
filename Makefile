# Gmail Contact Graph - Makefile
# ==============================

# Paths
RUST_PARSER_DIR = rust_parser
TOOLS_DIR = rust_parser/tools
DATA_DIR = data
MBOX_FILE = $(DATA_DIR)/gmail_data.mbox
CONTACTS_DB = $(DATA_DIR)/contacts.db
MAILS_DB = $(DATA_DIR)/mails.db

# User email (set via environment or override)
USER_EMAIL ?= your_email@example.com

# Detect OS for executable extension
ifeq ($(OS),Windows_NT)
    EXE = .exe
else
    EXE =
endif

# Binaries
FILL_DB = $(RUST_PARSER_DIR)/target/release/fill_db$(EXE)
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
	@echo "Filling databases from mbox..."
	@echo "Using email: $(USER_EMAIL)"
	$(FILL_DB) "$(MBOX_FILE)" "$(USER_EMAIL)" "$(MAILS_DB)" "$(CONTACTS_DB)"

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
	@echo "Removing databases..."
	rm -f $(CONTACTS_DB)
	rm -f $(MAILS_DB)

clean-all: clean clean-data clean-db

# ============================================
# Help
# ============================================

help:
	@echo "Gmail Contact Graph - Available targets:"
	@echo ""
	@echo "  Build:"
	@echo "    make build          - Build all (parser + tools)"
	@echo "    make build-parser   - Build rust_parser (fill_db)"
	@echo "    make build-tools    - Build ranking tools"
	@echo ""
	@echo "  Data processing:"
	@echo "    make fill-db        - Parse mbox and fill databases"
	@echo "                          Set USER_EMAIL=your@email.com"
	@echo "    make rankings       - Generate ranking files"
	@echo "    make process-all    - Run fill-db + rankings"
	@echo ""
	@echo "  Clean:"
	@echo "    make clean          - Clean build artifacts"
	@echo "    make clean-data     - Remove ranking files"
	@echo "    make clean-db       - Remove databases"
	@echo "    make clean-all      - Clean everything"
	@echo ""
	@echo "  Example:"
	@echo "    make fill-db USER_EMAIL=john@gmail.com"
	@echo "    make rankings"
