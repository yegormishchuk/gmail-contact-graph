# Calendar Parser - Makefile
# ==========================

DATA_DIR ?= ../data
DB_PATH  ?= $(DATA_DIR)/contacts.db
CALENDAR_DIR ?= $(DATA_DIR)/Calendar
ICS_FILES ?= $(CALENDAR_DIR)

ifeq ($(OS),Windows_NT)
    EXE = .exe
else
    EXE =
endif

FILL_EVENTS = target/release/fill_events$(EXE)

.PHONY: all build fill-events clean help

all: build

build:
	@echo "Building fill_events..."
	cargo build --release --bin fill_events

fill-events: build
	@echo "Filling events table from $(ICS_FILES)..."
	$(FILL_EVENTS) $(ICS_FILES) --db $(DB_PATH)

clean:
	cargo clean

help:
	@echo "Calendar Parser - Available targets:"
	@echo "  make build         - cargo build --release --bin fill_events"
	@echo "  make fill-events   - parse all .ics files in $(CALENDAR_DIR)"
	@echo "                       (override with ICS_FILES=\"a.ics b.ics\" or a different dir)"
	@echo "  make clean         - cargo clean"
	@echo ""
	@echo "  Variables:"
	@echo "    ICS_FILES        - space-separated paths (files or dirs); default $(CALENDAR_DIR)"
	@echo "    CALENDAR_DIR     - calendar dir (default $(CALENDAR_DIR))"
	@echo "    DB_PATH          - SQLite path (default $(DB_PATH))"
	@echo "    DATA_DIR         - data dir (default $(DATA_DIR))"
