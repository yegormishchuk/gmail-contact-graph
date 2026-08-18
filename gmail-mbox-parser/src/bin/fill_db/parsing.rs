use chrono::DateTime;

use gmail_mbox_parser::email::{parse_all_recipients, parse_sender};
use gmail_mbox_parser::mime::decode_mime_header;

use crate::models::EmailMessage;

// ---------------------------------------------------------------------------
// Header processing
// ---------------------------------------------------------------------------

pub fn flush_header(name: &str, value: &str, msg: &mut EmailMessage) {
    if name.is_empty() {
        return;
    }

    match name.to_lowercase().as_str() {
        "from" => {
            let full_line = format!("From:{}", value);
            let decoded = decode_mime_header(&full_line);
            if let Some((sender_name, email)) = parse_sender(&decoded) {
                msg.from_email = email.to_lowercase();
                msg.from_name = sender_name;
            }
        }
        "to" => {
            let decoded = decode_mime_header(value);
            let recipients = parse_all_recipients(&decoded);
            // parse_all_recipients returns (name, email), but we store (email, name)
            msg.to.extend(
                recipients
                    .into_iter()
                    .map(|(name, email)| (email.to_lowercase(), name)),
            );
        }
        "cc" => {
            let decoded = decode_mime_header(value);
            let recipients = parse_all_recipients(&decoded);
            // parse_all_recipients returns (name, email), but we store (email, name)
            msg.to.extend(
                recipients
                    .into_iter()
                    .map(|(name, email)| (email.to_lowercase(), name)),
            );
        }
        "subject" => {
            msg.subject = decode_mime_header(value).trim().to_string();
        }
        "delivered-to" => {
            // Gmail uses Delivered-To to indicate the actual recipient
            msg.delivered_to = value.trim().to_lowercase();
        }
        "x-delivered-to" => {
            if msg.delivered_to.is_empty() {
                msg.delivered_to = value.trim().to_lowercase();
            }
        }
        "date" => {
            msg.date = parse_date(value.trim());
        }
        "content-type" => {
            let (mime, boundary, charset) = parse_content_type(value);
            msg.content_type = mime;
            msg.boundary = boundary;
            if !charset.is_empty() {
                msg.charset = charset;
            }
        }
        "content-transfer-encoding" => {
            msg.transfer_encoding = value.trim().to_lowercase();
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Content-Type parsing
// ---------------------------------------------------------------------------

pub fn parse_content_type(value: &str) -> (String, String, String) {
    let parts: Vec<&str> = value.splitn(2, ';').collect();
    let mime_type = parts[0].trim().to_lowercase();

    let mut boundary = String::new();
    let mut charset = String::new();

    if let Some(params_str) = parts.get(1) {
        for param in params_str.split(';') {
            let param = param.trim();
            if let Some(eq) = param.find('=') {
                let key = param[..eq].trim().to_lowercase();
                let val = param[eq + 1..].trim().trim_matches('"').to_string();
                match key.as_str() {
                    "boundary" => boundary = val,
                    "charset" => charset = val.to_lowercase(),
                    _ => {}
                }
            }
        }
    }

    (mime_type, boundary, charset)
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

fn parse_date(raw: &str) -> Option<i64> {
    // Strip RFC 2822 comments in parentheses
    let cleaned = strip_comments(raw);
    let trimmed = cleaned.trim();

    if let Ok(dt) = DateTime::parse_from_rfc2822(trimmed) {
        return Some(dt.timestamp());
    }

    // Some dates have extra whitespace or missing day-of-week
    // Try stripping leading day name if present
    if let Some(comma) = trimmed.find(',') {
        let without_day = trimmed[comma + 1..].trim();
        if let Ok(dt) = DateTime::parse_from_rfc2822(&format!("Mon, {}", without_day)) {
            return Some(dt.timestamp());
        }
    }

    None
}

fn strip_comments(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut depth = 0;
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => result.push(c),
            _ => {}
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Statistics calculation
// ---------------------------------------------------------------------------

pub fn calculate_emails_per_month(first: i64, last: i64, total: u32) -> f64 {
    if first >= last {
        return total as f64;
    }

    let days = (last - first) as f64 / (24.0 * 60.0 * 60.0);
    let months = days / 30.44; // Average days per month

    if months < 1.0 {
        total as f64
    } else {
        (total as f64 / months * 100.0).round() / 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds one header through `flush_header` and hands back the message.
    fn header(name: &str, value: &str) -> EmailMessage {
        let mut msg = EmailMessage::default();
        flush_header(name, value, &mut msg);
        msg
    }

    // -----------------------------------------------------------------------
    // flush_header
    // -----------------------------------------------------------------------

    #[test]
    fn an_empty_header_name_is_ignored() {
        let msg = header("", " whatever");
        assert!(msg.from_email.is_empty());
        assert!(msg.subject.is_empty());
    }

    #[test]
    fn an_unknown_header_is_ignored() {
        let msg = header("X-Mailer", " Thunderbird");
        assert!(msg.subject.is_empty());
        assert!(msg.to.is_empty());
    }

    #[test]
    fn header_names_are_matched_case_insensitively() {
        let msg = header("SUBJECT", " Hello");
        assert_eq!(msg.subject, "Hello");
    }

    #[test]
    fn from_is_split_into_name_and_lowercased_address() {
        let msg = header("From", " Alice Smith <Alice@Example.com>");
        assert_eq!(msg.from_name, "Alice Smith");
        assert_eq!(msg.from_email, "alice@example.com");
    }

    #[test]
    fn to_is_stored_as_email_name_pairs() {
        let msg = header("To", " Alice <a@x.com>, Bob <b@y.com>");
        assert_eq!(
            msg.to,
            vec![
                ("a@x.com".to_string(), "Alice".to_string()),
                ("b@y.com".to_string(), "Bob".to_string()),
            ]
        );
    }

    #[test]
    fn cc_appends_to_the_same_recipient_list_as_to() {
        let mut msg = EmailMessage::default();
        flush_header("To", " Alice <a@x.com>", &mut msg);
        flush_header("Cc", " Bob <b@y.com>", &mut msg);
        assert_eq!(msg.to.len(), 2);
        assert_eq!(msg.to[1].0, "b@y.com");
    }

    #[test]
    fn a_mime_encoded_subject_is_decoded_and_trimmed() {
        let msg = header("Subject", " =?UTF-8?B?0J/RgNC40LLQtdGC?= ");
        assert_eq!(msg.subject, "Привет");
    }

    #[test]
    fn delivered_to_is_lowercased() {
        let msg = header("Delivered-To", " You@Gmail.COM ");
        assert_eq!(msg.delivered_to, "you@gmail.com");
    }

    #[test]
    fn x_delivered_to_does_not_overwrite_delivered_to() {
        let mut msg = EmailMessage::default();
        flush_header("Delivered-To", " first@x.com", &mut msg);
        flush_header("X-Delivered-To", " second@x.com", &mut msg);
        assert_eq!(msg.delivered_to, "first@x.com");
    }

    #[test]
    fn x_delivered_to_fills_in_when_delivered_to_is_absent() {
        let msg = header("X-Delivered-To", " only@x.com");
        assert_eq!(msg.delivered_to, "only@x.com");
    }

    #[test]
    fn content_type_populates_mime_boundary_and_charset() {
        let msg = header(
            "Content-Type",
            " multipart/alternative; boundary=\"abc123\"; charset=UTF-8",
        );
        assert_eq!(msg.content_type, "multipart/alternative");
        assert_eq!(msg.boundary, "abc123");
        assert_eq!(msg.charset, "utf-8");
    }

    #[test]
    fn an_empty_charset_does_not_clear_an_existing_one() {
        let mut msg = EmailMessage {
            charset: "windows-1251".to_string(),
            ..Default::default()
        };
        flush_header("Content-Type", " text/plain", &mut msg);
        assert_eq!(msg.charset, "windows-1251");
    }

    #[test]
    fn transfer_encoding_is_lowercased() {
        let msg = header("Content-Transfer-Encoding", " Base64 ");
        assert_eq!(msg.transfer_encoding, "base64");
    }

    // -----------------------------------------------------------------------
    // parse_content_type
    // -----------------------------------------------------------------------

    #[test]
    fn a_bare_mime_type_yields_empty_parameters() {
        let (mime, boundary, charset) = parse_content_type(" text/plain");
        assert_eq!(mime, "text/plain");
        assert_eq!(boundary, "");
        assert_eq!(charset, "");
    }

    #[test]
    fn quoted_and_unquoted_parameters_parse_the_same() {
        let quoted = parse_content_type("text/plain; boundary=\"a-b-c\"");
        let bare = parse_content_type("text/plain; boundary=a-b-c");
        assert_eq!(quoted.1, "a-b-c");
        assert_eq!(bare.1, "a-b-c");
    }

    #[test]
    fn unknown_parameters_are_skipped() {
        let (mime, boundary, charset) =
            parse_content_type("text/plain; format=flowed; charset=ISO-8859-1");
        assert_eq!(mime, "text/plain");
        assert_eq!(boundary, "");
        assert_eq!(charset, "iso-8859-1");
    }

    #[test]
    fn a_trailing_semicolon_is_harmless() {
        let (mime, _, charset) = parse_content_type("text/html; charset=utf-8;");
        assert_eq!(mime, "text/html");
        assert_eq!(charset, "utf-8");
    }

    // -----------------------------------------------------------------------
    // parse_date
    // -----------------------------------------------------------------------

    #[test]
    fn parses_a_plain_rfc2822_date() {
        assert_eq!(
            parse_date("Mon, 25 Dec 2023 10:30:00 +0000"),
            Some(1703500200)
        );
    }

    #[test]
    fn strips_parenthesised_comments_before_parsing() {
        assert_eq!(
            parse_date("Mon, 25 Dec 2023 10:30:00 +0000 (UTC)"),
            Some(1703500200)
        );
    }

    #[test]
    fn a_wrong_day_of_week_is_recovered_by_substituting_mon() {
        // "25 Dec 2023" was a Monday; claiming Friday must not lose the date.
        assert_eq!(
            parse_date("Fri, 25 Dec 2023 10:30:00 +0000"),
            Some(1703500200)
        );
    }

    #[test]
    fn an_unparseable_date_yields_none() {
        assert_eq!(parse_date("not a date"), None);
        assert_eq!(parse_date(""), None);
    }

    // -----------------------------------------------------------------------
    // calculate_emails_per_month
    // -----------------------------------------------------------------------

    const DAY: i64 = 24 * 60 * 60;

    #[test]
    fn a_span_under_one_month_reports_the_raw_total() {
        // 10 days is less than one 30.44-day month, so no rate is derived.
        assert_eq!(calculate_emails_per_month(0, 10 * DAY, 7), 7.0);
    }

    #[test]
    fn a_zero_or_inverted_span_reports_the_raw_total() {
        assert_eq!(calculate_emails_per_month(100, 100, 5), 5.0);
        assert_eq!(calculate_emails_per_month(200, 100, 5), 5.0);
    }

    #[test]
    fn a_longer_span_is_averaged_per_month_and_rounded() {
        // 12 * 30.44 days with 24 emails ≈ 2 per month.
        let span = (12.0 * 30.44 * DAY as f64) as i64;
        assert_eq!(calculate_emails_per_month(0, span, 24), 2.0);
    }
}
