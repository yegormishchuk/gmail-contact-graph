use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader};

use chrono::DateTime;
use rusqlite::{params, Connection};

use fast_mbox_parser::email::{parse_all_emails, parse_sender};
use fast_mbox_parser::mime::{base64_decode, body_quoted_printable_decode, decode_charset, decode_mime_header};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Default)]
struct EmailMessage {
    from: String,
    to: Vec<String>,
    subject: String,
    date: Option<i64>,
    content_type: String,
    transfer_encoding: String,
    charset: String,
    boundary: String,
    body: Vec<u8>,
}

enum ParseState {
    Seeking,
    Headers,
    Body,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: fill_db <mbox_file> [db_path]");
        std::process::exit(1);
    }

    let mbox_path = &args[1];
    let db_path = args.get(2).map(|s| s.as_str()).unwrap_or("data/mails.db");

    eprintln!("mbox: {}", mbox_path);
    eprintln!("  db: {}", db_path);

    let conn = Connection::open(db_path).expect("failed to open database");
    setup_db(&conn);

    let file = File::open(mbox_path).expect("failed to open mbox file");
    let reader = BufReader::with_capacity(1024 * 1024, file);

    let mut state = ParseState::Seeking;
    let mut msg = EmailMessage::default();
    let mut header_name = String::new();
    let mut header_value = String::new();
    let mut msg_count: u64 = 0;
    let mut row_count: u64 = 0;

    conn.execute_batch("BEGIN TRANSACTION").unwrap();
    let mut stmt = conn
        .prepare(
            "INSERT INTO mails (\"from\", \"to\", subject, content, date) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .unwrap();

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };

        match state {
            ParseState::Seeking => {
                if line.starts_with("From ") {
                    state = ParseState::Headers;
                    msg = EmailMessage::default();
                    header_name.clear();
                    header_value.clear();
                }
            }
            ParseState::Headers => {
                if line.is_empty() {
                    // End of headers — flush last header, switch to body
                    flush_header(&header_name, &header_value, &mut msg);
                    header_name.clear();
                    header_value.clear();
                    state = ParseState::Body;
                } else if line.starts_with(' ') || line.starts_with('\t') {
                    // Continuation of previous header
                    header_value.push(' ');
                    header_value.push_str(line.trim());
                } else if let Some(colon) = line.find(':') {
                    // New header — flush previous
                    flush_header(&header_name, &header_value, &mut msg);
                    header_name = line[..colon].to_string();
                    header_value = line[colon + 1..].to_string();
                }
            }
            ParseState::Body => {
                if line.starts_with("From ") {
                    // New message — finalize current
                    row_count += insert_message(&mut stmt, &msg);
                    msg_count += 1;
                    if msg_count % 5000 == 0 {
                        eprintln!("[progress] {} messages, {} rows", msg_count, row_count);
                    }
                    msg = EmailMessage::default();
                    header_name.clear();
                    header_value.clear();
                    state = ParseState::Headers;
                } else {
                    msg.body.extend_from_slice(line.as_bytes());
                    msg.body.push(b'\n');
                }
            }
        }
    }

    // Finalize last message
    if matches!(state, ParseState::Body | ParseState::Headers) {
        flush_header(&header_name, &header_value, &mut msg);
        row_count += insert_message(&mut stmt, &msg);
        msg_count += 1;
    }

    drop(stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!("Done: {} messages, {} rows inserted.", msg_count, row_count);
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

fn setup_db(conn: &Connection) {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -64000;
         PRAGMA temp_store = MEMORY;",
    )
    .unwrap();

    conn.execute_batch(
        "DROP TABLE IF EXISTS mails;
         CREATE TABLE mails (
             id      INTEGER PRIMARY KEY AUTOINCREMENT,
             \"from\"  TEXT NOT NULL,
             \"to\"    TEXT NOT NULL,
             subject TEXT NOT NULL DEFAULT '',
             content TEXT NOT NULL DEFAULT '',
             date    INTEGER
         );
         CREATE INDEX IF NOT EXISTS idx_mails_from ON mails(\"from\");
         CREATE INDEX IF NOT EXISTS idx_mails_to   ON mails(\"to\");
         CREATE INDEX IF NOT EXISTS idx_mails_date ON mails(date);",
    )
    .unwrap();
}

// ---------------------------------------------------------------------------
// Header processing
// ---------------------------------------------------------------------------

fn flush_header(name: &str, value: &str, msg: &mut EmailMessage) {
    if name.is_empty() {
        return;
    }

    match name.to_lowercase().as_str() {
        "from" => {
            let full_line = format!("From:{}", value);
            let decoded = decode_mime_header(&full_line);
            if let Some((_name, email)) = parse_sender(&decoded) {
                msg.from = email;
            }
        }
        "to" => {
            let decoded = decode_mime_header(value);
            let emails = parse_all_emails(&decoded);
            msg.to.extend(emails);
        }
        "cc" => {
            let decoded = decode_mime_header(value);
            let emails = parse_all_emails(&decoded);
            msg.to.extend(emails);
        }
        "subject" => {
            msg.subject = decode_mime_header(value).trim().to_string();
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
// Insert into DB
// ---------------------------------------------------------------------------

fn insert_message(stmt: &mut rusqlite::Statement, msg: &EmailMessage) -> u64 {
    let content = extract_text_content(
        &msg.body,
        &msg.content_type,
        &msg.transfer_encoding,
        &msg.charset,
        &msg.boundary,
        0,
    );

    if msg.to.is_empty() {
        let _ = stmt.execute(params![msg.from, "", msg.subject, content, msg.date]);
        return 1;
    }

    let mut rows = 0u64;
    for recipient in &msg.to {
        if stmt
            .execute(params![msg.from, recipient, msg.subject, content, msg.date])
            .is_ok()
        {
            rows += 1;
        }
    }
    rows
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

fn extract_text_content(
    body: &[u8],
    content_type: &str,
    transfer_encoding: &str,
    charset: &str,
    boundary: &str,
    depth: usize,
) -> String {
    if depth > 5 {
        return String::new();
    }

    let ct = if content_type.is_empty() {
        "text/plain"
    } else {
        content_type.as_ref()
    };

    if ct.starts_with("multipart/") {
        if boundary.is_empty() {
            return String::new();
        }
        return extract_from_multipart(body, boundary, depth);
    }

    if !ct.starts_with("text/plain") {
        return String::new();
    }

    // Decode transfer encoding
    let decoded_bytes = decode_transfer_encoding(body, transfer_encoding);

    // Decode charset
    let cs = if charset.is_empty() { "utf-8" } else { charset };
    decode_charset(&decoded_bytes, cs)
}

fn decode_transfer_encoding(data: &[u8], encoding: &str) -> Vec<u8> {
    match encoding {
        "base64" => {
            // Remove whitespace, then decode
            let clean: String = data
                .iter()
                .filter(|&&b| !b.is_ascii_whitespace())
                .map(|&b| b as char)
                .collect();
            base64_decode(&clean).unwrap_or_else(|| data.to_vec())
        }
        "quoted-printable" => body_quoted_printable_decode(data),
        _ => data.to_vec(), // 7bit, 8bit, binary — use as-is
    }
}

fn extract_from_multipart(body: &[u8], boundary: &str, depth: usize) -> String {
    let parts = split_multipart(body, boundary);

    // Prefer text/plain, fallback to first text result
    let mut fallback = String::new();

    for part in &parts {
        let (part_headers, part_body) = split_part_headers(part);
        let (ct, sub_boundary, cs) = parse_content_type(
            part_headers.get("content-type").map(|s| s.as_str()).unwrap_or(""),
        );
        let te = part_headers
            .get("content-transfer-encoding")
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_default();

        let text = extract_text_content(part_body, &ct, &te, &cs, &sub_boundary, depth + 1);

        if !text.is_empty() {
            if ct.starts_with("text/plain") || ct.is_empty() {
                return text; // Found plain text — return immediately
            }
            if fallback.is_empty() {
                fallback = text;
            }
        }
    }

    fallback
}

fn split_multipart<'a>(body: &'a [u8], boundary: &str) -> Vec<&'a [u8]> {
    let delim = format!("--{}", boundary);
    let closing = format!("--{}--", boundary);

    let mut parts = Vec::new();
    let mut in_part = false;
    let mut part_start = 0;
    let mut pos = 0;
    let body_len = body.len();

    while pos < body_len {
        // Find next newline
        let line_end = body[pos..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| pos + p)
            .unwrap_or(body_len);

        let line = &body[pos..line_end];
        let line_trimmed = if line.last() == Some(&b'\r') {
            &line[..line.len() - 1]
        } else {
            line
        };

        let line_str = String::from_utf8_lossy(line_trimmed);

        if line_str.starts_with(&closing) {
            if in_part && part_start < pos {
                parts.push(&body[part_start..pos]);
            }
            break;
        } else if line_str.starts_with(delim.as_str()) {
            if in_part && part_start < pos {
                parts.push(&body[part_start..pos]);
            }
            in_part = true;
            part_start = if line_end < body_len {
                line_end + 1
            } else {
                body_len
            };
        }

        pos = if line_end < body_len {
            line_end + 1
        } else {
            body_len
        };
    }

    parts
}

fn split_part_headers(part: &[u8]) -> (std::collections::HashMap<String, String>, &[u8]) {
    let mut headers = std::collections::HashMap::new();
    let mut pos = 0;
    let mut last_key = String::new();

    // Find the blank line separating headers from body
    while pos < part.len() {
        let line_end = part[pos..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|p| pos + p)
            .unwrap_or(part.len());

        let line = &part[pos..line_end];
        let line = if line.last() == Some(&b'\r') {
            &line[..line.len() - 1]
        } else {
            line
        };

        if line.is_empty() {
            // Blank line — body starts after
            let body_start = if line_end < part.len() {
                line_end + 1
            } else {
                part.len()
            };
            return (headers, &part[body_start..]);
        }

        let line_str = String::from_utf8_lossy(line);

        if line_str.starts_with(' ') || line_str.starts_with('\t') {
            // Continuation
            if let Some(val) = headers.get_mut(&last_key) {
                val.push(' ');
                val.push_str(line_str.trim());
            }
        } else if let Some(colon) = line_str.find(':') {
            let key = line_str[..colon].to_lowercase();
            let value = line_str[colon + 1..].trim().to_string();
            last_key = key.clone();
            headers
                .entry(key)
                .and_modify(|v: &mut String| {
                    v.push_str(", ");
                    v.push_str(&value);
                })
                .or_insert(value);
        }

        pos = if line_end < part.len() {
            line_end + 1
        } else {
            part.len()
        };
    }

    (headers, &part[part.len()..])
}

// ---------------------------------------------------------------------------
// Content-Type parsing
// ---------------------------------------------------------------------------

fn parse_content_type(value: &str) -> (String, String, String) {
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
