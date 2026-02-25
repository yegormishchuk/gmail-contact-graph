use chrono::DateTime;

use fast_mbox_parser::email::{parse_all_recipients, parse_sender};
use fast_mbox_parser::mime::decode_mime_header;

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
            msg.to.extend(recipients.into_iter().map(|(name, email)| (email.to_lowercase(), name)));
        }
        "cc" => {
            let decoded = decode_mime_header(value);
            let recipients = parse_all_recipients(&decoded);
            // parse_all_recipients returns (name, email), but we store (email, name)
            msg.to.extend(recipients.into_iter().map(|(name, email)| (email.to_lowercase(), name)));
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
