"""Flask backend for Gmail Contact Graph visualization."""

import sys
import time
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, jsonify, render_template

from src.parser import parse_mbox_auto, save_contacts_json, load_contacts_json, RUST_AVAILABLE
from src.config import DEFAULT_MBOX_FILE, DEFAULT_CONTACTS_FILE, MY_EMAIL, MY_NAME

app = Flask(__name__)

# Global contacts cache
_contacts_cache = None


def parse_contacts_on_startup():
    """Parse mbox file on startup and cache results."""
    global _contacts_cache

    if not DEFAULT_MBOX_FILE.exists():
        print(f"Warning: mbox file not found: {DEFAULT_MBOX_FILE}")
        print("Loading from existing contacts.json...")
        _contacts_cache = load_contacts_json(DEFAULT_CONTACTS_FILE)
        return

    file_size_mb = DEFAULT_MBOX_FILE.stat().st_size / (1024 * 1024)
    parser_name = "Rust" if RUST_AVAILABLE else "Python"

    print(f"Parsing {DEFAULT_MBOX_FILE.name} ({file_size_mb:.1f} MB) with {parser_name}...")

    start = time.perf_counter()
    _contacts_cache = parse_mbox_auto(DEFAULT_MBOX_FILE, MY_EMAIL)
    elapsed = time.perf_counter() - start

    print(f"Parsed {len(_contacts_cache)} contacts in {elapsed:.2f}s ({file_size_mb/elapsed:.1f} MB/s)")

    # Save to JSON for backup
    save_contacts_json(_contacts_cache, DEFAULT_CONTACTS_FILE)


def get_contacts():
    """Get contacts from cache."""
    global _contacts_cache
    if _contacts_cache is None:
        parse_contacts_on_startup()
    return _contacts_cache


@app.route('/')
def index():
    """Serve main page."""
    return render_template('index.html')


@app.route('/api/graph')
def get_graph():
    """
    Get graph data for D3.js visualization.
    Returns nodes and links in D3 force-directed graph format.
    """
    contacts = get_contacts()

    # Build nodes
    nodes = [
        {
            "id": "me",
            "name": MY_NAME,
            "email": MY_EMAIL,
            "isCenter": True,
            "received": 0,
            "sent": 0
        }
    ]

    for contact in contacts:
        display_name = contact.name if contact.name else contact.email.split('@')[0]
        nodes.append({
            "id": contact.email,
            "name": display_name,
            "email": contact.email,
            "isCenter": False,
            "received": contact.received_count,
            "sent": contact.sent_count
        })

    # Build links
    links = []
    for contact in contacts:
        if contact.received_count > 0:
            links.append({
                "source": contact.email,
                "target": "me",
                "type": "received",
                "count": contact.received_count
            })

        if contact.sent_count > 0:
            links.append({
                "source": "me",
                "target": contact.email,
                "type": "sent",
                "count": contact.sent_count
            })

    return jsonify({
        "nodes": nodes,
        "links": links,
        "stats": {
            "totalContacts": len(contacts),
            "displayedContacts": len(contacts),
            "totalReceived": sum(c.received_count for c in contacts),
            "totalSent": sum(c.sent_count for c in contacts)
        }
    })


@app.route('/api/contacts')
def api_contacts():
    """Get all contacts as a list."""
    contacts = get_contacts()
    return jsonify([contact.to_dict() for contact in contacts])


if __name__ == '__main__':
    # Parse mbox on startup
    parse_contacts_on_startup()
    app.run(debug=True, port=5000)
