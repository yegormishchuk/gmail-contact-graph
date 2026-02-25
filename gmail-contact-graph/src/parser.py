"""Contact loading utilities for the webapp."""

import sqlite3
from collections import defaultdict
from pathlib import Path

from .models import Contact

# Common email provider domains to ignore when grouping by organization
IGNORED_DOMAINS: set[str] = {
    # Google
    "gmail.com", "googlemail.com", "google.com",
    # Yandex
    "yandex.ru", "yandex.com", "yandex.ua", "yandex.by", "yandex.kz",
    "ya.ru",
    # Mail.ru Group
    "mail.ru", "inbox.ru", "list.ru", "bk.ru", "internet.ru",
    # Rambler
    "rambler.ru", "lenta.ru", "autorambler.ru", "myrambler.ru", "ro.ru",
    # Microsoft
    "outlook.com", "hotmail.com", "live.com", "live.ru", "msn.com",
    # Yahoo
    "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de",
    # Apple
    "icloud.com", "me.com", "mac.com",
    # Other popular
    "protonmail.com", "proton.me",
    "tutanota.com", "tuta.io",
    "aol.com",
    "zoho.com",
    "ukr.net",
    "i.ua",
    "meta.ua",
    "bigmir.net",
}


def group_contacts_by_domain(contacts: list[Contact]) -> dict[str, list[Contact]]:
    """
    Group contacts by email domain, ignoring common public email providers.

    Returns a dict mapping domain -> list of contacts from that domain,
    sorted by number of users per domain (descending).
    Only includes domains with at least 2 contacts.
    """
    domain_map: dict[str, list[Contact]] = {}

    for contact in contacts:
        parts = contact.email.split('@')
        if len(parts) != 2:
            continue

        domain = parts[1].lower()
        if domain in IGNORED_DOMAINS:
            continue

        if domain not in domain_map:
            domain_map[domain] = []
        domain_map[domain].append(contact)

    # Filter: keep only domains with 2+ contacts (actual organizations)
    domain_map = {
        domain: users
        for domain, users in domain_map.items()
        if len(users) >= 2
    }

    # Sort by number of users descending
    domain_map = dict(
        sorted(domain_map.items(), key=lambda item: len(item[1]), reverse=True)
    )

    return domain_map


def load_contacts_from_filtered(db_path: str | Path) -> list[Contact]:
    """Load contacts from contacts_filtered table (pre-filtered by Rust pipeline)."""
    conn = sqlite3.connect(str(db_path))

    rows = conn.execute(
        'SELECT name, email, received, sent, not_clear FROM contacts_filtered'
    ).fetchall()

    conn.close()

    contacts = [
        Contact(
            name=name if name else email.split('@')[0],
            email=email,
            received_count=received,
            sent_count=sent,
            not_clear=bool(not_clear),
        )
        for name, email, received, sent, not_clear in rows
    ]

    contacts.sort(key=lambda c: c.total_count, reverse=True)
    return contacts


def load_excluded_contacts(db_path: str | Path) -> list[Contact]:
    """Load contacts that are in contacts_candidates but NOT in contacts_filtered (spam/not humans)."""
    conn = sqlite3.connect(str(db_path))

    rows = conn.execute(
        '''SELECT c.name, c.email, c.received, c.sent
           FROM contacts_candidates c
           WHERE c.email NOT IN (SELECT email FROM contacts_filtered)'''
    ).fetchall()

    conn.close()

    contacts = [
        Contact(
            name=name if name else email.split('@')[0],
            email=email,
            received_count=received,
            sent_count=sent,
        )
        for name, email, received, sent in rows
    ]

    contacts.sort(key=lambda c: c.total_count, reverse=True)
    return contacts


def load_message_groups_from_db(db_path: str | Path, my_email: str) -> dict[str, list[str]]:
    """Load message groups from SQLite database (data/mails.db).

    Returns dict: subject -> list of unique recipient emails.
    Only includes subjects with 2+ unique recipients.
    """
    my_email = my_email.lower()
    conn = sqlite3.connect(str(db_path))

    rows = conn.execute(
        'SELECT subject, "to" FROM mails '
        'WHERE "from" = ? AND "to" != ? AND subject != "" AND length("to") > 1',
        (my_email, my_email),
    ).fetchall()

    conn.close()

    groups: dict[str, set[str]] = defaultdict(set)
    for subject, recipient in rows:
        groups[subject].add(recipient)

    # Keep only groups with 2+ unique recipients
    return {
        subject: list(recipients)
        for subject, recipients in groups.items()
        if len(recipients) >= 2
    }
