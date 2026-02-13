"""Flask backend for Gmail Contact Graph visualization."""

import sys
import time
from pathlib import Path
from typing import Dict, List, Callable, Any

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import sqlite3

from flask import Flask, jsonify, render_template, request

from src.parser import load_contacts_from_filtered, load_message_groups_from_db, group_contacts_by_domain, load_excluded_contacts
from src.config import DEFAULT_DB_FILE, CONTACTS_DB_FILE, MY_EMAIL, MY_NAME

app = Flask(__name__)

# Global contacts cache
_contacts_cache = None
_message_groups_cache = None
_composite_scores_cache = None
_excluded_contacts_cache = None


# =============================================================================
# Composite Ranking System
# =============================================================================

class RankingConfig:
    """Configuration for a ranking that participates in composite score."""
    def __init__(self, name: str, coefficient: float, value_fn: Callable):
        self.name = name
        self.coefficient = coefficient
        self.value_fn = value_fn


# Configure rankings and their coefficients (easy to modify)
RANKING_CONFIGS = [
    RankingConfig("sent", 1.0, lambda c: c.sent_count),
    RankingConfig("received", 0.2, lambda c: c.received_count),
]


def assign_ranks(contacts: List, value_fn: Callable) -> Dict[str, int]:
    """Assign ranks to contacts based on value function (descending order)."""
    # Sort by value descending
    sorted_contacts = sorted(contacts, key=lambda c: value_fn(c), reverse=True)

    email_to_rank = {}
    current_rank = 1
    prev_value = None
    same_value_count = 0

    for contact in sorted_contacts:
        value = value_fn(contact)
        if prev_value is not None:
            if value == prev_value:
                same_value_count += 1
            else:
                current_rank += same_value_count
                same_value_count = 1
        else:
            same_value_count = 1

        email_to_rank[contact.email] = current_rank
        prev_value = value

    return email_to_rank


def calculate_composite_scores(contacts: List) -> Dict[str, Dict[str, Any]]:
    """
    Calculate composite scores for all contacts.
    Returns dict: email -> {score, rankings: [(name, rank, points), ...]}
    """
    if not contacts:
        return {}

    total_contacts = len(contacts)

    # Initialize scores
    scores = {c.email: {"score": 0.0, "rankings": []} for c in contacts}

    # Process each ranking
    for config in RANKING_CONFIGS:
        ranks = assign_ranks(contacts, config.value_fn)

        for email, rank in ranks.items():
            # Points: 1st place = n, 2nd = n-1, etc.
            points = max(0, total_contacts - rank + 1)
            weighted_points = points * config.coefficient

            scores[email]["score"] += weighted_points
            scores[email]["rankings"].append({
                "name": config.name,
                "rank": rank,
                "points": weighted_points
            })

    return scores


def load_data_on_startup():
    """Load contacts and message groups from SQLite database."""
    global _contacts_cache, _message_groups_cache, _composite_scores_cache, _excluded_contacts_cache

    if not CONTACTS_DB_FILE.exists():
        print(f"Error: contacts database not found: {CONTACTS_DB_FILE}")
        print("Run fill_db first to populate the database.")
        _contacts_cache = []
        _message_groups_cache = {}
        _composite_scores_cache = {}
        _excluded_contacts_cache = []
        return

    if not DEFAULT_DB_FILE.exists():
        print(f"Error: mails database not found: {DEFAULT_DB_FILE}")
        _message_groups_cache = {}

    print(f"Loading contacts from {CONTACTS_DB_FILE.name}, mails from {DEFAULT_DB_FILE.name}...")
    start = time.perf_counter()

    _contacts_cache = load_contacts_from_filtered(CONTACTS_DB_FILE)
    _message_groups_cache = load_message_groups_from_db(DEFAULT_DB_FILE, MY_EMAIL) if DEFAULT_DB_FILE.exists() else {}
    _composite_scores_cache = calculate_composite_scores(_contacts_cache)
    _excluded_contacts_cache = load_excluded_contacts(CONTACTS_DB_FILE)

    elapsed = time.perf_counter() - start
    groups_count = len(_message_groups_cache)
    excluded_count = len(_excluded_contacts_cache)
    print(f"Loaded {len(_contacts_cache)} contacts, {excluded_count} excluded, {groups_count} message groups in {elapsed:.2f}s")
    print(f"Composite ranking: {len(RANKING_CONFIGS)} rankings with coefficients: {', '.join(f'{c.name}={c.coefficient}' for c in RANKING_CONFIGS)}")


def get_contacts():
    """Get contacts from cache."""
    global _contacts_cache
    if _contacts_cache is None:
        load_data_on_startup()
    return _contacts_cache


def get_composite_scores():
    """Get composite scores from cache."""
    global _composite_scores_cache
    if _composite_scores_cache is None:
        load_data_on_startup()
    return _composite_scores_cache


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
    composite_scores = get_composite_scores()

    # Build nodes
    nodes = [
        {
            "id": "me",
            "name": MY_NAME,
            "email": MY_EMAIL,
            "isCenter": True,
            "received": 0,
            "sent": 0,
            "compositeScore": 999999999  # Center always first
        }
    ]

    for contact in contacts:
        display_name = contact.name if contact.name else contact.email.split('@')[0]
        score_data = composite_scores.get(contact.email, {"score": 0, "rankings": []})
        nodes.append({
            "id": contact.email,
            "name": display_name,
            "email": contact.email,
            "isCenter": False,
            "received": contact.received_count,
            "sent": contact.sent_count,
            "compositeScore": score_data["score"],
            "rankings": score_data["rankings"],
            "notClear": contact.not_clear
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


@app.route('/api/contacts/mark-clear', methods=['POST'])
def mark_contact_clear():
    """Mark a contact as clear (definitely a person)."""
    global _contacts_cache

    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"error": "Email required"}), 400

    # Update database
    conn = sqlite3.connect(str(CONTACTS_DB_FILE))
    conn.execute('UPDATE contacts_filtered SET not_clear = 0 WHERE email = ?', (email,))
    conn.commit()
    conn.close()

    # Update cache
    if _contacts_cache:
        for contact in _contacts_cache:
            if contact.email == email:
                contact.not_clear = False
                break

    return jsonify({"success": True, "email": email})


@app.route('/api/contacts/mark-not-human', methods=['POST'])
def mark_contact_not_human():
    """Mark a contact as not a human (delete from contacts_filtered)."""
    global _contacts_cache, _composite_scores_cache, _excluded_contacts_cache

    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"error": "Email required"}), 400

    # Delete from contacts_filtered table
    conn = sqlite3.connect(str(CONTACTS_DB_FILE))
    conn.execute('DELETE FROM contacts_filtered WHERE email = ?', (email,))
    conn.commit()
    conn.close()

    # Remove from contacts cache
    if _contacts_cache:
        _contacts_cache = [c for c in _contacts_cache if c.email != email]

    # Recalculate composite scores
    _composite_scores_cache = calculate_composite_scores(_contacts_cache)

    # Reload excluded contacts
    _excluded_contacts_cache = load_excluded_contacts(CONTACTS_DB_FILE)

    return jsonify({"success": True, "email": email})


@app.route('/api/contacts/restore', methods=['POST'])
def restore_contact():
    """Restore a contact from spam back to contacts_filtered."""
    global _contacts_cache, _composite_scores_cache, _excluded_contacts_cache

    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"error": "Email required"}), 400

    # Get contact data from contacts_candidates
    conn = sqlite3.connect(str(CONTACTS_DB_FILE))
    row = conn.execute(
        'SELECT name, email, received, sent FROM contacts_candidates WHERE email = ?',
        (email,)
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "Contact not found in candidates"}), 404

    name, email, received, sent = row

    # Insert into contacts_filtered
    conn.execute(
        'INSERT OR REPLACE INTO contacts_filtered (name, email, received, sent, not_clear) VALUES (?, ?, ?, ?, 0)',
        (name, email, received, sent)
    )
    conn.commit()
    conn.close()

    # Reload all caches
    _contacts_cache = load_contacts_from_filtered(CONTACTS_DB_FILE)
    _composite_scores_cache = calculate_composite_scores(_contacts_cache)
    _excluded_contacts_cache = load_excluded_contacts(CONTACTS_DB_FILE)

    return jsonify({"success": True, "email": email})


@app.route('/api/excluded-contacts')
def api_excluded_contacts():
    """Get contacts that are in candidates but not in filtered (spam/not humans)."""
    global _excluded_contacts_cache
    if _excluded_contacts_cache is None:
        load_data_on_startup()

    return jsonify([
        {
            "name": c.name,
            "email": c.email,
            "received": c.received_count,
            "sent": c.sent_count,
            "total": c.total_count,
        }
        for c in _excluded_contacts_cache
    ])


if __name__ == '__main__':
    load_data_on_startup()
    
    app.run(debug=True, port=5000)
