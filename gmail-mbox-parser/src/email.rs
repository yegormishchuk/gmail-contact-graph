use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};

/// Parse email Date header and return Unix timestamp.
/// Handles common formats: RFC 2822 and variations.
pub fn parse_email_date(line: &str) -> Option<i64> {
    // Remove "Date: " prefix
    let date_str = line.strip_prefix("Date:")?.trim();

    // Try RFC 2822 format first (most common in emails)
    if let Ok(dt) = DateTime::parse_from_rfc2822(date_str) {
        return Some(dt.timestamp());
    }

    // Try common variations
    let formats = [
        "%a, %d %b %Y %H:%M:%S %z",      // Mon, 25 Dec 2023 10:30:00 +0000
        "%d %b %Y %H:%M:%S %z",           // 25 Dec 2023 10:30:00 +0000
        "%a, %d %b %Y %H:%M:%S",          // Mon, 25 Dec 2023 10:30:00
        "%d %b %Y %H:%M:%S",              // 25 Dec 2023 10:30:00
        "%Y-%m-%d %H:%M:%S %z",           // 2023-12-25 10:30:00 +0000
        "%Y-%m-%d %H:%M:%S",              // 2023-12-25 10:30:00
    ];

    // Clean up date string - remove timezone name in parentheses like "(PST)"
    let cleaned = if let Some(paren_pos) = date_str.find('(') {
        date_str[..paren_pos].trim()
    } else {
        date_str
    };

    for fmt in formats {
        if let Ok(dt) = DateTime::parse_from_str(cleaned, fmt) {
            return Some(dt.timestamp());
        }
        // Try without timezone
        if let Ok(naive) = NaiveDateTime::parse_from_str(cleaned, fmt) {
            return Some(Utc.from_utc_datetime(&naive).timestamp());
        }
    }

    None
}

/// Extract name and email from a "From: " line.
pub fn parse_sender(line: &str) -> Option<(String, String)> {
    let sender = line.get(5..)?.trim();

    // Find email (word containing @)
    let email = sender
        .split_whitespace()
        .find(|word| word.contains('@'))?
        .trim_matches(|c| "<>\"',;()".contains(c))
        .to_lowercase();

    if email.is_empty() || !email.contains('@') {
        return None;
    }

    // Extract name (part before <email>)
    let name = if let Some(pos) = sender.find('<') {
        let name_part = sender[..pos].trim().trim_matches(|c| "\"'".contains(c));
        if name_part.is_empty() || name_part.to_lowercase() == email {
            email.split('@').next().unwrap_or(&email).to_string()
        } else {
            name_part.to_string()
        }
    } else {
        email.split('@').next().unwrap_or(&email).to_string()
    };

    Some((name, email))
}

/// Extract all email addresses from a header value (To/CC field content).
pub fn parse_all_emails(text: &str) -> Vec<String> {
    let mut emails = Vec::new();
    for part in text.split(',') {
        for word in part.split_whitespace() {
            if word.contains('@') {
                let email = word
                    .trim_matches(|c| "<>\"',;()".contains(c))
                    .to_lowercase();
                if !email.is_empty() && email.contains('@') {
                    emails.push(email);
                }
                break;
            }
        }
    }
    emails
}

/// Extract all (name, email) pairs from a header value (To/CC field content).
pub fn parse_all_recipients(text: &str) -> Vec<(String, String)> {
    let mut recipients = Vec::new();
    for part in text.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let fake_from = format!("From: {}", part);
        if let Some((name, email)) = parse_sender(&fake_from) {
            recipients.push((name, email));
        }
    }
    recipients
}
