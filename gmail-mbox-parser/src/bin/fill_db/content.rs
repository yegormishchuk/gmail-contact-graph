use std::collections::HashMap;

use gmail_mbox_parser::mime::{base64_decode, body_quoted_printable_decode, decode_charset};

use crate::parsing::parse_content_type;

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

pub fn extract_text_content(
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
            part_headers
                .get("content-type")
                .map(|s| s.as_str())
                .unwrap_or(""),
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

fn split_part_headers(part: &[u8]) -> (HashMap<String, String>, &[u8]) {
    let mut headers = HashMap::new();
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
