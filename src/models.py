"""Data models for Gmail Contact Graph."""

from dataclasses import dataclass


@dataclass
class Contact:
    """Represents an email contact with communication statistics."""
    name: str
    email: str
    received_count: int = 0  # emails received FROM this contact
    sent_count: int = 0      # emails sent TO this contact
    not_clear: bool = False  # contact may not be a real person

    @property
    def total_count(self) -> int:
        """Total number of emails exchanged with this contact."""
        return self.received_count + self.sent_count

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "email": self.email,
            "received": self.received_count,
            "sent": self.sent_count,
            "not_clear": self.not_clear
        }
