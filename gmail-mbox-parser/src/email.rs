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
        "%a, %d %b %Y %H:%M:%S %z", // Mon, 25 Dec 2023 10:30:00 +0000
        "%d %b %Y %H:%M:%S %z",     // 25 Dec 2023 10:30:00 +0000
        "%a, %d %b %Y %H:%M:%S",    // Mon, 25 Dec 2023 10:30:00
        "%d %b %Y %H:%M:%S",        // 25 Dec 2023 10:30:00
        "%Y-%m-%d %H:%M:%S %z",     // 2023-12-25 10:30:00 +0000
        "%Y-%m-%d %H:%M:%S",        // 2023-12-25 10:30:00
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

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // parse_sender
    // -----------------------------------------------------------------------

    #[test]
    fn splits_a_display_name_from_the_address() {
        let (name, email) = parse_sender("From: Alice Smith <alice@example.com>").unwrap();
        assert_eq!(name, "Alice Smith");
        assert_eq!(email, "alice@example.com");
    }

    #[test]
    fn a_bare_address_uses_the_local_part_as_the_name() {
        let (name, email) = parse_sender("From: alice@example.com").unwrap();
        assert_eq!(name, "alice");
        assert_eq!(email, "alice@example.com");
    }

    #[test]
    fn the_address_is_lowercased() {
        let (_, email) = parse_sender("From: <Alice@Example.COM>").unwrap();
        assert_eq!(email, "alice@example.com");
    }

    #[test]
    fn quotes_around_the_display_name_are_stripped() {
        let (name, _) = parse_sender("From: \"Alice Smith\" <alice@example.com>").unwrap();
        assert_eq!(name, "Alice Smith");
    }

    #[test]
    fn a_name_equal_to_the_address_collapses_to_the_local_part() {
        let (name, _) = parse_sender("From: alice@example.com <alice@example.com>").unwrap();
        assert_eq!(name, "alice");
    }

    #[test]
    fn a_line_without_an_address_is_rejected() {
        assert!(parse_sender("From: Alice Smith").is_none());
        assert!(parse_sender("From:").is_none());
    }

    #[test]
    fn a_line_too_short_to_hold_a_prefix_is_rejected() {
        // `parse_sender` slices at byte 5; anything shorter must not panic.
        assert!(parse_sender("From").is_none());
        assert!(parse_sender("").is_none());
    }

    // -----------------------------------------------------------------------
    // parse_all_recipients / parse_all_emails
    // -----------------------------------------------------------------------

    #[test]
    fn collects_every_comma_separated_recipient() {
        let got = parse_all_recipients("Alice <a@x.com>, Bob <b@y.com>");
        assert_eq!(
            got,
            vec![
                ("Alice".to_string(), "a@x.com".to_string()),
                ("Bob".to_string(), "b@y.com".to_string()),
            ]
        );
    }

    #[test]
    fn empty_and_addressless_segments_are_skipped() {
        let got = parse_all_recipients("Alice <a@x.com>, , not an address, b@y.com");
        assert_eq!(
            got,
            vec![
                ("Alice".to_string(), "a@x.com".to_string()),
                ("b".to_string(), "b@y.com".to_string()),
            ]
        );
    }

    #[test]
    fn parse_all_emails_returns_bare_addresses() {
        let got = parse_all_emails("Alice <a@x.com>, Bob <b@y.com>");
        assert_eq!(got, vec!["a@x.com", "b@y.com"]);
    }

    #[ignore = "known bug: the address is taken from the first whitespace-\
                separated word containing '@', so a display name holding an \
                address wins over the real one in angle brackets"]
    #[test]
    fn an_address_inside_the_display_name_does_not_win() {
        let (name, email) = parse_sender("From: \"bot@spam.com\" <real@person.com>").unwrap();
        assert_eq!(email, "real@person.com");
        assert_eq!(name, "bot@spam.com");
        // Actual today: ("bot", "bot@spam.com") — the real address is lost.
    }

    #[ignore = "known bug: splitting on ',' cuts quoted display names in half; \
                the surname segment has no '@' and is silently dropped"]
    #[test]
    fn a_comma_inside_a_quoted_display_name_is_not_a_separator() {
        let got = parse_all_recipients("\"Smith, John\" <j@x.com>");
        assert_eq!(
            got,
            vec![("Smith, John".to_string(), "j@x.com".to_string())]
        );
        // Actual today: [("John", "j@x.com")] — address right, surname lost.
    }

    #[test]
    fn parse_all_emails_takes_only_the_first_address_per_segment() {
        // The inner loop breaks after the first '@' word in each segment.
        let got = parse_all_emails("a@x.com b@y.com");
        assert_eq!(got, vec!["a@x.com"]);
    }

    // -----------------------------------------------------------------------
    // parse_email_date
    // -----------------------------------------------------------------------

    #[test]
    fn parses_an_rfc2822_date() {
        // 2023-12-25T10:30:00Z
        assert_eq!(
            parse_email_date("Date: Mon, 25 Dec 2023 10:30:00 +0000"),
            Some(1703500200)
        );
    }

    #[test]
    fn applies_the_utc_offset() {
        assert_eq!(
            parse_email_date("Date: Mon, 25 Dec 2023 10:30:00 +0200"),
            Some(1703500200 - 2 * 3600)
        );
    }

    #[test]
    fn strips_a_trailing_timezone_comment() {
        assert_eq!(
            parse_email_date("Date: Mon, 25 Dec 2023 10:30:00 +0000 (UTC)"),
            Some(1703500200)
        );
    }

    #[test]
    fn a_line_without_the_date_prefix_is_rejected() {
        assert!(parse_email_date("Mon, 25 Dec 2023 10:30:00 +0000").is_none());
    }

    #[test]
    fn an_unparseable_date_is_rejected() {
        assert!(parse_email_date("Date: sometime last tuesday").is_none());
        assert!(parse_email_date("Date:").is_none());
    }
}
