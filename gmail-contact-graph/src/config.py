"""Configuration for Gmail Contact Graph."""

import os
from pathlib import Path

# Project root directory
PROJECT_ROOT = Path(__file__).parent.parent

# Data directory - configurable via DATA_DIR env var
DATA_DIR = Path(os.environ.get("DATA_DIR", PROJECT_ROOT / "data"))

# Database paths
DEFAULT_DB_FILE = DATA_DIR / "mails.db"  # Parsed email messages
CONTACTS_DB_FILE = DATA_DIR / "contacts.db"  # Filtered contacts from Rust pipeline

# User configuration - configurable via env vars
MY_EMAIL = os.environ.get("MY_EMAIL", "your.email@gmail.com")
MY_NAME = os.environ.get("MY_NAME", "Your Name")
