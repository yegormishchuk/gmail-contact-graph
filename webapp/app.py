"""
Flask backend for Gmail Contact Graph visualization.
Provides API to get contact data for D3.js graph.
"""

from flask import Flask, jsonify, render_template
from pathlib import Path
import json
from dataclasses import dataclass

app = Flask(__name__)

# Path to data files
DATA_DIR = Path(__file__).parent.parent
CONTACTS_FILE = DATA_DIR / "contacts.json"


@dataclass
class Contact:
    name: str
    email: str
    received_count: int = 0  # emails received FROM this contact
    sent_count: int = 0      # emails sent TO this contact


def load_contacts() -> list[Contact]:
    """Load contacts from contacts.json file."""
    if not CONTACTS_FILE.exists():
        return []

    with open(CONTACTS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Build a map of email -> contact
    contacts_map: dict[str, Contact] = {}

    # Process senders (emails received from them)
    for sender in data.get("senders", []):
        email = sender["email"].lower()
        contacts_map[email] = Contact(
            name=sender["name"],
            email=email,
            received_count=sender["count"],
            sent_count=0
        )

    # Process recipients (emails sent to them)
    for recipient in data.get("recipients", []):
        email = recipient["email"].lower()
        if email in contacts_map:
            contacts_map[email].sent_count = recipient["count"]
        else:
            contacts_map[email] = Contact(
                name=recipient["name"],
                email=email,
                received_count=0,
                sent_count=recipient["count"]
            )

    return list(contacts_map.values())


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
    contacts = load_contacts()

    # Filter to top contacts (by total activity) to keep visualization manageable
    contacts.sort(key=lambda c: c.received_count + c.sent_count, reverse=True)
    top_contacts = contacts[:50]  # Top 50 contacts

    # Build nodes
    nodes = [
        {
            "id": "me",
            "name": "Егор Мищук",
            "email": "you@example.com",
            "isCenter": True,
            "received": 0,
            "sent": 0
        }
    ]

    for contact in top_contacts:
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
    for contact in top_contacts:
        # Link from contact to me (received emails)
        if contact.received_count > 0:
            links.append({
                "source": contact.email,
                "target": "me",
                "type": "received",
                "count": contact.received_count
            })

        # Link from me to contact (sent emails)
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
            "displayedContacts": len(top_contacts),
            "totalReceived": sum(c.received_count for c in contacts),
            "totalSent": sum(c.sent_count for c in contacts)
        }
    })


@app.route('/api/contacts')
def get_contacts():
    """Get all contacts as a list."""
    contacts = load_contacts()
    contacts.sort(key=lambda c: c.received_count + c.sent_count, reverse=True)

    return jsonify([
        {
            "name": c.name,
            "email": c.email,
            "received": c.received_count,
            "sent": c.sent_count
        }
        for c in contacts
    ])


if __name__ == '__main__':
    app.run(debug=True, port=5000)
