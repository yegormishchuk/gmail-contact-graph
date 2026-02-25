# Gmail Contact Graph Webapp - Makefile
# =====================================

# Data directory (should match parser output)
DATA_DIR ?= data

# Python
PYTHON ?= python
VENV_DIR = venv

# Detect OS for venv activation
ifeq ($(OS),Windows_NT)
    VENV_ACTIVATE = $(VENV_DIR)\Scripts\activate
    VENV_PYTHON = $(VENV_DIR)\Scripts\python
else
    VENV_ACTIVATE = $(VENV_DIR)/bin/activate
    VENV_PYTHON = $(VENV_DIR)/bin/python
endif

# ============================================
# Main targets
# ============================================

.PHONY: all setup venv run clean help

all: setup

# ============================================
# Setup targets
# ============================================

setup: venv
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
	@echo "Using data from: $(DATA_DIR)"
	DATA_DIR=$(DATA_DIR) $(VENV_PYTHON) webapp/app.py

run-dev:
	@echo "Starting in development mode..."
	DATA_DIR=$(DATA_DIR) FLASK_DEBUG=1 $(VENV_PYTHON) webapp/app.py

# ============================================
# Clean targets
# ============================================

clean:
	@echo "Removing virtual environment..."
	rm -rf $(VENV_DIR)
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# ============================================
# Help
# ============================================

help:
	@echo "Gmail Contact Graph Webapp - Available targets:"
	@echo ""
	@echo "  Setup:"
	@echo "    make setup          - Create virtual environment"
	@echo "    make venv           - Create Python virtual environment"
	@echo ""
	@echo "  Run:"
	@echo "    make run            - Start the web application"
	@echo "    make run-dev        - Start in development mode"
	@echo ""
	@echo "  Clean:"
	@echo "    make clean          - Remove venv and cache files"
	@echo ""
	@echo "  Variables:"
	@echo "    DATA_DIR            - Data directory with databases (default: data)"
	@echo "    MY_EMAIL            - Your email (env var, for display)"
	@echo "    MY_NAME             - Your name (env var, for display)"
	@echo ""
	@echo "  Prerequisites:"
	@echo "    Run gmail-mbox-parser first to generate contacts.db and mails.db"
	@echo ""
	@echo "  Example:"
	@echo "    make setup"
	@echo "    DATA_DIR=~/gmail-data MY_EMAIL=john@gmail.com make run"
