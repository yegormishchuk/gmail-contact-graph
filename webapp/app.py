"""Flask backend for Gmail Contact Graph visualization."""

import sys
import time
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, jsonify, render_template

from src.parser import load_contacts_from_db, load_message_groups_from_db, group_contacts_by_domain
from src.config import DEFAULT_DB_FILE, MY_EMAIL, MY_NAME

app = Flask(__name__)

# Global contacts cache
_contacts_cache = None
_message_groups_cache = None


def load_data_on_startup():
    """Load contacts and message groups from SQLite database."""
    global _contacts_cache, _message_groups_cache

    if not DEFAULT_DB_FILE.exists():
        print(f"Error: database not found: {DEFAULT_DB_FILE}")
        print("Run fill_db first to populate the database.")
        _contacts_cache = []
        _message_groups_cache = {}
        return

    print(f"Loading data from {DEFAULT_DB_FILE.name}...")
    start = time.perf_counter()

    _contacts_cache = load_contacts_from_db(DEFAULT_DB_FILE, MY_EMAIL)
    _message_groups_cache = load_message_groups_from_db(DEFAULT_DB_FILE, MY_EMAIL)

    elapsed = time.perf_counter() - start
    groups_count = len(_message_groups_cache)
    print(f"Loaded {len(_contacts_cache)} contacts, {groups_count} message groups in {elapsed:.2f}s")


def get_contacts():
    """Get contacts from cache."""
    global _contacts_cache
    if _contacts_cache is None:
        load_data_on_startup()
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


@app.route('/api/domains')
def api_domains():
    """Get contacts grouped by organizational email domain."""
    contacts = get_contacts()
    domain_groups = group_contacts_by_domain(contacts)

    result = {}
    for domain, users in domain_groups.items():
        result[domain] = [
            {
                "name": c.name,
                "email": c.email,
                "received": c.received_count,
                "sent": c.sent_count,
                "total": c.total_count,
            }
            for c in sorted(users, key=lambda c: c.total_count, reverse=True)
        ]

    return jsonify({
        "total_domains": len(result),
        "domain_groups": result,
    })


@app.route('/api/message-groups')
def api_message_groups():
    """Get message groups (multi-recipient emails grouped by subject)."""
    global _message_groups_cache
    if _message_groups_cache is None:
        load_data_on_startup()

    groups = _message_groups_cache or {}
    return jsonify({
        "total_groups": len(groups),
        "groups": {subject: recipients for subject, recipients in groups.items()},
    })


if __name__ == '__main__':
    load_data_on_startup()
    
    app.run(debug=True, port=5000)
