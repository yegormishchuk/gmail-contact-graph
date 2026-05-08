# Calendar Parser - Makefile
# ==========================

DATA_DIR ?= ../data
DB_PATH  ?= $(DATA_DIR)/contacts.db
ICS_FILES ?=

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
	@echo "Filling events table from .ics files..."
	@if [ -z "$(ICS_FILES)" ]; then \
	  echo "Set ICS_FILES, e.g.: make fill-events ICS_FILES=\"$(DATA_DIR)/Calendar/foo.ics $(DATA_DIR)/Calendar/bar.ics\""; \
	  exit 1; \
	fi
	$(FILL_EVENTS) $(ICS_FILES) --db $(DB_PATH)

clean:
	cargo clean

help:
	@echo "Calendar Parser - Available targets:"
	@echo "  make build         - cargo build --release --bin fill_events"
	@echo "  make fill-events ICS_FILES=\"a.ics b.ics\""
	@echo "  make clean         - cargo clean"
	@echo ""
	@echo "  Variables:"
	@echo "    ICS_FILES        - space-separated .ics paths (required)"
	@echo "    DB_PATH          - SQLite path (default $(DB_PATH))"
	@echo "    DATA_DIR         - data dir (default $(DATA_DIR))"
