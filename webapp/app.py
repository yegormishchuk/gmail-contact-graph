"""Flask backend for Gmail Contact Graph visualization."""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Flask, jsonify, render_template

from src.parser import load_contacts_json
from src.config import DEFAULT_CONTACTS_FILE, MY_EMAIL, MY_NAME

app = Flask(__name__)


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
    contacts = load_contacts_json(DEFAULT_CONTACTS_FILE)

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
def get_contacts():
    """Get all contacts as a list."""
    contacts = load_contacts_json(DEFAULT_CONTACTS_FILE)
    return jsonify([contact.to_dict() for contact in contacts])


if __name__ == '__main__':
    app.run(debug=True, port=5000)
