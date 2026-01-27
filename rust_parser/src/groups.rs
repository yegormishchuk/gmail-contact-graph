use pyo3::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::email::{parse_all_emails, parse_sender};
use crate::mime::decode_mime_header;

/// Finalize a multi-recipient message group, merging into the groups map.
fn finalize_message_group(
    groups: &mut HashMap<String, Vec<String>>,
    subject: &str,
    recipients: &[String],
    my_email: &str,
) {
    // Deduplicate and exclude self
    let mut seen = HashSet::new();
    let unique: Vec<String> = recipients
        .iter()
        .filter(|e| {
            let e_str = e.as_str();
            e_str != my_email && seen.insert(e_str.to_string())
        })
        .cloned()
        .collect();

    if subject.is_empty() || unique.len() < 2 {
        return;
    }

    let entry = groups.entry(subject.to_string()).or_default();
    let mut existing: HashSet<String> = entry.iter().cloned().collect();
    for email in unique {
        if existing.insert(email.clone()) {
            entry.push(email);
        }
    }
}

/// Parse mbox file to find multi-recipient emails sent by the user.
///
/// Returns dict mapping Subject -> list of unique recipient emails.
/// Only includes messages with 2+ recipients.
#[pyfunction]
pub fn parse_message_groups(
    path: &str,
    my_email: &str,
) -> PyResult<HashMap<String, Vec<String>>> {
    let my_email = my_email.to_lowercase();
    let mut groups: HashMap<String, Vec<String>> = HashMap::new();

    let file = File::open(path).map_err(|e| {
        pyo3::exceptions::PyIOError::new_err(format!("Failed to open file: {}", e))
    })?;

    let reader = BufReader::with_capacity(1024 * 1024, file);

    let mut in_sent_headers = false;
    let mut current_subject = String::new();
    let mut current_recipients: Vec<String> = Vec::new();
    // Subject may appear before From: in the same message's headers.
    // Buffer it so we can use it when From: is encountered.
    let mut pre_from_subject = String::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            if in_sent_headers {
                finalize_message_group(
                    &mut groups,
                    &current_subject,
                    &current_recipients,
                    &my_email,
                );
                in_sent_headers = false;
            }
            pre_from_subject.clear();
            continue;
        }

        if line.starts_with("From:") {
            if in_sent_headers {
                finalize_message_group(
                    &mut groups,
                    &current_subject,
                    &current_recipients,
                    &my_email,
                );
                in_sent_headers = false;
            }

            let decoded = decode_mime_header(&line);
            if let Some((_, email)) = parse_sender(&decoded) {
                if email == my_email {
                    in_sent_headers = true;
                    // Use subject already seen in this message's headers
                    current_subject = std::mem::take(&mut pre_from_subject);
                    current_recipients = Vec::new();
                }
            }
            pre_from_subject.clear();
        } else if line.starts_with("Subject:") {
            let decoded = decode_mime_header(&line);
            let subject = decoded
                .get("Subject:".len()..)
                .unwrap_or("")
                .trim()
                .to_string();
            if in_sent_headers {
                current_subject = subject;
            } else {
                pre_from_subject = subject;
            }
        } else if in_sent_headers {
            if line.starts_with("To:")
                || line.starts_with("Cc:")
                || line.starts_with("CC:")
            {
                let decoded = decode_mime_header(&line);
                let content = decoded.get(3..).unwrap_or("");
                let emails = parse_all_emails(content);
                current_recipients.extend(emails);
            }
        }
    }

    // Finalize last message
    if in_sent_headers {
        finalize_message_group(
            &mut groups,
            &current_subject,
            &current_recipients,
            &my_email,
        );
    }

    Ok(groups)
}
