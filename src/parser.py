"""Mbox file parser for extracting email contacts."""

import json
from collections import Counter
from email.header import decode_header
from pathlib import Path

from .models import Contact

# Try to import Rust extension for faster parsing
try:
    import fast_mbox_parser as _rust_parser
    RUST_AVAILABLE = True
except ImportError:
    RUST_AVAILABLE = False


def decode_mime_header(text: str) -> str:
    """Decode MIME encoded-word headers like =?UTF-8?B?...?="""
    try:
        decoded_parts = decode_header(text)
        result = []
        for data, charset in decoded_parts:
            if isinstance(data, bytes):
                result.append(data.decode(charset or 'utf-8', errors='replace'))
            else:
                result.append(data)
        return ''.join(result)
    except Exception:
        return text


def parse_sender(line: str) -> tuple[str, str] | None:
    """
    Extract name and email from a "From: " line.

    Returns (name, email) tuple or None if no email found.
    """
    sender = line[6:].strip()

    email = None
    for word in sender.split():
        if '@' in word:
            email = word.strip('<>"\',;').lower()
            break

    if not email:
        return None

    name = sender.split('<')[0].strip().strip('"\'')
    if not name or name.lower() == email:
        name = email.split('@')[0]

    return (name, email)


def parse_mbox(mbox_file: str | Path, my_email: str) -> list[Contact]:
    """
    Parse mbox file to extract contacts with email counts.

    Args:
        mbox_file: Path to the mbox file
        my_email: Your email address (to identify sent vs received)

    Returns:
        List of Contact objects with received/sent counts
    """
    my_email = my_email.lower()
    mbox_file = Path(mbox_file)

    sender_counts: Counter[str] = Counter()
    sender_names: dict[str, str] = {}

    recipient_counts: Counter[str] = Counter()
    recipient_names: dict[str, str] = {}

    looking_for_to = False

    with open(mbox_file, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            if line.strip() == "":
                looking_for_to = False
                continue

            if line.startswith("From:"):
                decoded = decode_mime_header(line.rstrip('\n\r'))
                result = parse_sender(decoded)
                if result:
                    name, email = result
                    if email == my_email:
                        looking_for_to = True
                    else:
                        looking_for_to = False
                        sender_counts[email] += 1
                        if email not in sender_names:
                            sender_names[email] = name

            elif looking_for_to and line.startswith("To:"):
                decoded = decode_mime_header(line.rstrip('\n\r'))
                to_line = "From: " + decoded[4:]
                result = parse_sender(to_line)
                if result:
                    name, email = result
                    recipient_counts[email] += 1
                    if email not in recipient_names:
                        recipient_names[email] = name

    # Merge senders and recipients into contacts
    contacts_map: dict[str, Contact] = {}

    for email, count in sender_counts.items():
        contacts_map[email] = Contact(
            name=sender_names[email],
            email=email,
            received_count=count,
            sent_count=0
        )

    for email, count in recipient_counts.items():
        if email in contacts_map:
            contacts_map[email].sent_count = count
        else:
            contacts_map[email] = Contact(
                name=recipient_names[email],
                email=email,
                received_count=0,
                sent_count=count
            )

    # Sort by total activity
    contacts = list(contacts_map.values())
    contacts.sort(key=lambda c: c.total_count, reverse=True)

    return contacts


def parse_mbox_fast(mbox_file: str | Path, my_email: str, num_threads: int = 0) -> list[Contact]:
    """
    Parse mbox file using fast Rust extension with parallel processing.

    Args:
        mbox_file: Path to the mbox file
        my_email: Your email address (to identify sent vs received)
        num_threads: Number of threads (0 = auto-detect based on CPU cores)

    Returns:
        List of Contact objects with received/sent counts

    Raises:
        ImportError: If Rust extension is not installed
    """
    if not RUST_AVAILABLE:
        raise ImportError(
            "fast_mbox_parser not installed. "
            "Install with: cd rust_parser && maturin develop --release"
        )

    mbox_file = Path(mbox_file)
    rust_contacts = _rust_parser.parse_mbox(str(mbox_file), my_email, num_threads)

    return [
        Contact(
            name=c.name,
            email=c.email,
            received_count=c.received_count,
            sent_count=c.sent_count,
        )
        for c in rust_contacts
    ]


def parse_mbox_auto(mbox_file: str | Path, my_email: str) -> list[Contact]:
    """
    Parse mbox file, automatically using Rust extension if available.

    Falls back to pure Python implementation if Rust extension is not installed.
    """
    if RUST_AVAILABLE:
        return parse_mbox_fast(mbox_file, my_email)
    else:
        return parse_mbox(mbox_file, my_email)


def save_contacts_json(contacts: list[Contact], output_file: str | Path) -> None:
    """Save contacts to JSON file."""
    output_file = Path(output_file)

    # Format for backward compatibility with existing webapp
    data = {
        "senders": [
            {"name": c.name, "email": c.email, "count": c.received_count}
            for c in contacts if c.received_count > 0
        ],
        "recipients": [
            {"name": c.name, "email": c.email, "count": c.sent_count}
            for c in contacts if c.sent_count > 0
        ]
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_contacts_json(input_file: str | Path) -> list[Contact]:
    """Load contacts from JSON file."""
    input_file = Path(input_file)

    if not input_file.exists():
        return []

    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    contacts_map: dict[str, Contact] = {}

    for sender in data.get("senders", []):
        email = sender["email"].lower()
        contacts_map[email] = Contact(
            name=sender["name"],
            email=email,
            received_count=sender["count"],
            sent_count=0
        )

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

    contacts = list(contacts_map.values())
    contacts.sort(key=lambda c: c.total_count, reverse=True)

    return contacts
