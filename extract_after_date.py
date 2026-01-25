#!/usr/bin/env python3
"""
Script to extract lines following "Date: " lines from mbox file.
"""

from email.header import decode_header
from collections import Counter
from dataclasses import dataclass


@dataclass
class Contact:
    name: str
    email: str
    count: int


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


def extract_from_lines(input_file: str, output_file: str, limit: int = 500):
    """
    Stream-read mbox file and extract lines starting with "From:".

    Args:
        input_file: Path to the mbox file
        output_file: Path to output file
        limit: Maximum number of lines to extract
    """
    count = 0
    total_lines = 0

    with open(input_file, 'r', encoding='utf-8', errors='replace') as infile, \
         open(output_file, 'w', encoding='utf-8') as outfile:

        for line in infile:
            total_lines += 1
            if count >= limit:
                break

            if line.startswith("From:"):
                decoded_line = decode_mime_header(line.rstrip('\n\r'))
                outfile.write(decoded_line + '\n')
                count += 1

    print(f"Processed {total_lines} lines, extracted {count} 'From:' lines to {output_file}")


def parse_sender(line: str) -> tuple[str, str] | None:
    """
    Extract name and email from a "From: " line.

    Returns (name, email) tuple or None if no email found.
    """
    # Remove "From: " prefix
    sender = line[6:].strip()

    email = None
    for word in sender.split():
        if '@' in word:
            email = word.strip('<>"\',;').lower()
            break

    if not email:
        return None

    # Extract name: everything before the email part
    name = sender.split('<')[0].strip().strip('"\'')
    if not name or name.lower() == email:
        name = email.split('@')[0]

    return (name, email)


def parse_contacts(mbox_file: str, my_email: str) -> tuple[list[Contact], list[Contact]]:
    """
    Parse mbox file in single pass to get senders and recipients.

    Args:
        mbox_file: Path to the mbox file
        my_email: Your email address

    Returns:
        Tuple of (senders, recipients) lists sorted by count descending
    """
    my_email = my_email.lower()

    sender_counts: Counter[str] = Counter()
    sender_names: dict[str, str] = {}

    recipient_counts: Counter[str] = Counter()
    recipient_names: dict[str, str] = {}

    looking_for_to = False

    with open(mbox_file, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            # Empty line = end of headers, stop looking for To:
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

    senders = [
        Contact(name=sender_names[email], email=email, count=count)
        for email, count in sender_counts.most_common()
    ]

    recipients = [
        Contact(name=recipient_names[email], email=email, count=count)
        for email, count in recipient_counts.most_common()
    ]

    return senders, recipients


def extract_lines_after_date(input_file: str, output_file: str, limit: int = 500):
    """
    Stream-read mbox file and extract lines that follow "Date: " lines.

    Args:
        input_file: Path to the mbox file
        output_file: Path to output file
        limit: Maximum number of lines to extract
    """
    count = 0
    total_lines = 0
    found_date = False

    with open(input_file, 'r', encoding='utf-8', errors='replace') as infile, \
         open(output_file, 'w', encoding='utf-8') as outfile:

        for line in infile:
            total_lines += 1
            if count >= limit:
                break

            if found_date:
                outfile.write(line)
                count += 1
                found_date = False
            elif line.startswith("Date: "):
                found_date = True

    print(f"Processed {total_lines} lines, extracted {count} lines to {output_file}")


def save_contacts_json(senders: list[Contact], recipients: list[Contact], output_file: str):
    """Save contacts to JSON file for webapp."""
    import json

    data = {
        "senders": [
            {"name": c.name, "email": c.email, "count": c.count}
            for c in senders
        ],
        "recipients": [
            {"name": c.name, "email": c.email, "count": c.count}
            for c in recipients
        ]
    }

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(senders)} senders and {len(recipients)} recipients to {output_file}")


if __name__ == "__main__":
    senders, recipients = parse_contacts(
        mbox_file="gmail_data.mbox",
        my_email="you@example.com"
    )

    print(f"Found {len(senders)} unique senders")
    for contact in senders[:10]:
        print(f"  {contact.count}\t{contact.name} <{contact.email}>")

    print(f"\nFound {len(recipients)} unique recipients")
    for contact in recipients[:10]:
        print(f"  {contact.count}\t{contact.name} <{contact.email}>")

    # Save to JSON for webapp
    save_contacts_json(senders, recipients, "contacts.json")
