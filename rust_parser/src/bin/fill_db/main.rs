mod content;
mod db;
mod hf;
mod meetings;
mod models;
mod parsing;
mod spam;

use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader};

use rusqlite::{params, Connection};

use hf::{ContactForVerification, HFClient, HFConfig};
use models::{ContactStats, EmailMessage, ParseState};
use spam::is_spam_contact;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() {
    // Load .env file if present
    let _ = dotenvy::dotenv();

    let args: Vec<String> = env::args().collect();

    if args.len() < 3 {
        eprintln!("Usage: fill_db <mbox_file> <user_email> [db_path]");
        std::process::exit(1);
    }

    let mbox_path = &args[1];
    let user_email = args[2].to_lowercase();
    let db_path = args.get(3).map(|s| s.as_str()).unwrap_or("data/contacts.db");

    eprintln!("     mbox: {}", mbox_path);
    eprintln!("user_email: {}", user_email);
    eprintln!("       db: {}", db_path);

    // Phase 1: Fill mails table
    let contact_stats = fill_mails_db(mbox_path, &user_email, db_path);

    // Phase 2: Fill contacts table from accumulated statistics
    fill_contacts_db(&contact_stats, db_path);

    // Phase 3: Fill candidates table (basic spam filter)
    let candidates = fill_candidates_db(db_path);

    // Phase 4: AI verification and fill filtered contacts table
    if !candidates.is_empty() {
        fill_filtered_with_ai(db_path, candidates).await;
    } else {
        eprintln!("No candidates for AI verification.");
    }
}

// ---------------------------------------------------------------------------
// Phase 1: Fill mails table
// ---------------------------------------------------------------------------

fn fill_mails_db(mbox_path: &str, user_email: &str, db_path: &str) -> HashMap<String, ContactStats> {
    let conn = Connection::open(db_path).expect("failed to open database");
    db::setup_mails_db(&conn);

    let file = File::open(mbox_path).expect("failed to open mbox file");
    let reader = BufReader::with_capacity(1024 * 1024, file);

    let mut state = ParseState::Seeking;
    let mut msg = EmailMessage::default();
    let mut header_name = String::new();
    let mut header_value = String::new();
    let mut msg_count: u64 = 0;
    let mut row_count: u64 = 0;
    let mut skipped_count: u64 = 0;

    // Contact statistics accumulator
    let mut contact_stats: HashMap<String, ContactStats> = HashMap::new();

    conn.execute_batch("BEGIN TRANSACTION").unwrap();
    let mut stmt = conn
        .prepare(
            "INSERT INTO mails (\"from\", from_name, \"to\", to_name, subject, content, date) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
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
                    parsing::flush_header(&header_name, &header_value, &mut msg);
                    header_name.clear();
                    header_value.clear();
                    state = ParseState::Body;
                } else if line.starts_with(' ') || line.starts_with('\t') {
                    // Continuation of previous header
                    header_value.push(' ');
                    header_value.push_str(line.trim());
                } else if let Some(colon) = line.find(':') {
                    // New header — flush previous
                    parsing::flush_header(&header_name, &header_value, &mut msg);
                    header_name = line[..colon].to_string();
                    header_value = line[colon + 1..].to_string();
                }
            }
            ParseState::Body => {
                if line.starts_with("From ") {
                    // New message — finalize current
                    let result = db::insert_message(&mut stmt, &msg, user_email, &mut contact_stats);
                    row_count += result.0;
                    if result.1 {
                        skipped_count += 1;
                    }
                    msg_count += 1;
                    if msg_count % 5000 == 0 {
                        eprintln!("[progress] {} messages, {} rows, {} skipped", msg_count, row_count, skipped_count);
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
        parsing::flush_header(&header_name, &header_value, &mut msg);
        let result = db::insert_message(&mut stmt, &msg, user_email, &mut contact_stats);
        row_count += result.0;
        if result.1 {
            skipped_count += 1;
        }
        msg_count += 1;
    }

    drop(stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!("Mails DB: {} messages, {} rows inserted, {} skipped.", msg_count, row_count, skipped_count);

    contact_stats
}

// ---------------------------------------------------------------------------
// Phase 2: Fill contacts table
// ---------------------------------------------------------------------------

fn fill_contacts_db(contact_stats: &HashMap<String, ContactStats>, db_path: &str) {
    let conn = Connection::open(db_path).expect("failed to open database");
    db::setup_contacts_table(&conn);

    conn.execute_batch("BEGIN TRANSACTION").unwrap();
    let mut stmt = conn
        .prepare(
            "INSERT INTO contacts (name, email, received, sent, sent_per_month, received_per_month, average_chars, duration, meetings) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .unwrap();

    let mut inserted = 0u64;

    for (email, stats) in contact_stats {
        let total = stats.received + stats.sent;
        if total == 0 {
            continue;
        }

        // Calculate sent_per_month and received_per_month
        let (sent_per_month, received_per_month) = match (stats.first_timestamp, stats.last_timestamp) {
            (Some(first), Some(last)) => (
                Some(parsing::calculate_emails_per_month(first, last, stats.sent)),
                Some(parsing::calculate_emails_per_month(first, last, stats.received)),
            ),
            _ => (None, None),
        };

        // Calculate average_chars
        let average_chars = if stats.email_count > 0 {
            Some((stats.total_chars as f64 / stats.email_count as f64 * 100.0).round() / 100.0)
        } else {
            None
        };

        // Calculate duration in days
        let duration = match (stats.first_timestamp, stats.last_timestamp) {
            (Some(first), Some(last)) if last > first => {
                Some(((last - first) as f64 / (24.0 * 60.0 * 60.0) * 100.0).round() / 100.0)
            }
            _ => Some(0.0),
        };

        // Use name from stats, fallback to email prefix
        let name = if stats.name.is_empty() {
            email.split('@').next().unwrap_or(email).to_string()
        } else {
            stats.name.clone()
        };

        if stmt
            .execute(params![
                name,
                email,
                stats.received,
                stats.sent,
                sent_per_month,
                received_per_month,
                average_chars,
                duration,
                stats.meetings
            ])
            .is_ok()
        {
            inserted += 1;
        }
    }

    drop(stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!("Contacts table: {} contacts inserted.", inserted);
}

// ---------------------------------------------------------------------------
// Phase 3: Fill candidates table (basic spam filter)
// ---------------------------------------------------------------------------

/// Contact candidate with all fields for later insertion
#[derive(Clone)]
struct ContactCandidate {
    name: String,
    email: String,
    received: u32,
    sent: u32,
    sent_per_month: Option<f64>,
    received_per_month: Option<f64>,
    average_chars: Option<f64>,
    duration: Option<f64>,
    meetings: u32,
}

fn fill_candidates_db(db_path: &str) -> Vec<ContactCandidate> {
    let conn = Connection::open(db_path).expect("failed to open database");
    db::setup_candidates_table(&conn);

    conn.execute_batch("BEGIN TRANSACTION").unwrap();

    let mut select_stmt = conn
        .prepare(
            "SELECT name, email, received, sent, sent_per_month, received_per_month, average_chars, duration, meetings \
             FROM contacts",
        )
        .unwrap();

    let mut insert_stmt = conn
        .prepare(
            "INSERT INTO contacts_candidates (name, email, received, sent, sent_per_month, received_per_month, average_chars, duration, meetings) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .unwrap();

    let mut total = 0u64;
    let mut kept = 0u64;
    let mut candidates = Vec::new();

    let contacts_iter = select_stmt
        .query_map([], |row| {
            Ok(ContactCandidate {
                name: row.get(0)?,
                email: row.get(1)?,
                received: row.get(2)?,
                sent: row.get(3)?,
                sent_per_month: row.get(4)?,
                received_per_month: row.get(5)?,
                average_chars: row.get(6)?,
                duration: row.get(7)?,
                meetings: row.get(8)?,
            })
        })
        .unwrap();

    for contact_result in contacts_iter {
        let candidate = match contact_result {
            Ok(c) => c,
            Err(_) => continue,
        };

        total += 1;

        if is_spam_contact(&candidate.email, &candidate.name, candidate.received, candidate.sent) {
            continue;
        }

        if insert_stmt
            .execute(params![
                candidate.name,
                candidate.email,
                candidate.received,
                candidate.sent,
                candidate.sent_per_month,
                candidate.received_per_month,
                candidate.average_chars,
                candidate.duration,
                candidate.meetings
            ])
            .is_ok()
        {
            candidates.push(candidate);
            kept += 1;
        }
    }

    drop(select_stmt);
    drop(insert_stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!(
        "Candidates: {} total, {} passed basic filter, {} removed as spam.",
        total,
        kept,
        total - kept
    );

    candidates
}

// ---------------------------------------------------------------------------
// Phase 4: AI verification and fill filtered contacts table
// ---------------------------------------------------------------------------

async fn fill_filtered_with_ai(db_path: &str, candidates: Vec<ContactCandidate>) {
    eprintln!("\n=== Phase 4: AI Verification ===");

    // Check if HF_API_KEY is set
    let config = match HFConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping AI verification: {}", e);
            eprintln!("Set HF_API_KEY to enable AI verification.");
            // Fallback: copy all candidates to filtered with not_clear = true
            fallback_fill_filtered(db_path, &candidates);
            return;
        }
    };

    eprintln!("Model: {}", config.model);
    eprintln!("Batch size: {}", config.batch_size);
    eprintln!("Contacts to verify: {}", candidates.len());

    // Create HF client
    let client = match HFClient::new(config) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to create HF client: {}", e);
            fallback_fill_filtered(db_path, &candidates);
            return;
        }
    };

    // Convert to verification format
    let contacts_for_verification: Vec<ContactForVerification> = candidates
        .iter()
        .map(|c| ContactForVerification {
            name: c.name.clone(),
            email: c.email.clone(),
        })
        .collect();

    // Run AI verification
    eprintln!("\nRunning AI verification (4 votes per batch, unanimous required)...");
    let results = client.classify_all(&contacts_for_verification).await;

    // Build email -> classification map
    let mut classifications: HashMap<String, u8> = HashMap::new();
    let mut errors = 0u64;

    for result in results {
        match result {
            Ok(r) => {
                classifications.insert(r.email, r.classification);
            }
            Err(e) => {
                eprintln!("  [ERROR] {}", e);
                errors += 1;
            }
        }
    }

    // Fill contacts_filtered based on AI results
    let conn = Connection::open(db_path).expect("failed to open database");
    db::setup_filtered_contacts_table(&conn);

    conn.execute_batch("BEGIN TRANSACTION").unwrap();

    let mut insert_stmt = conn
        .prepare(
            "INSERT INTO contacts_filtered (name, email, received, sent, sent_per_month, received_per_month, average_chars, duration, meetings, not_clear) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .unwrap();

    let mut human_count = 0u64;
    let mut unclear_count = 0u64;
    let mut not_human_count = 0u64;

    for candidate in &candidates {
        let classification = classifications.get(&candidate.email).copied().unwrap_or(2);

        match classification {
            0 => {
                // Not human - don't add to filtered
                not_human_count += 1;
            }
            1 => {
                // Human - add with not_clear = false
                if insert_stmt
                    .execute(params![
                        candidate.name,
                        candidate.email,
                        candidate.received,
                        candidate.sent,
                        candidate.sent_per_month,
                        candidate.received_per_month,
                        candidate.average_chars,
                        candidate.duration,
                        candidate.meetings,
                        0 // not_clear = false
                    ])
                    .is_ok()
                {
                    human_count += 1;
                }
            }
            _ => {
                // Unknown/unclear - add with not_clear = true
                if insert_stmt
                    .execute(params![
                        candidate.name,
                        candidate.email,
                        candidate.received,
                        candidate.sent,
                        candidate.sent_per_month,
                        candidate.received_per_month,
                        candidate.average_chars,
                        candidate.duration,
                        candidate.meetings,
                        1 // not_clear = true
                    ])
                    .is_ok()
                {
                    unclear_count += 1;
                }
            }
        }
    }

    drop(insert_stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!("\n=== AI Verification Results ===");
    eprintln!("Total candidates: {}", candidates.len());
    eprintln!("  Human (added, not_clear=0): {}", human_count);
    eprintln!("  Unclear (added, not_clear=1): {}", unclear_count);
    eprintln!("  Not human (removed): {}", not_human_count);
    eprintln!("  Errors: {}", errors);
    eprintln!("Final filtered contacts: {}", human_count + unclear_count);
}

/// Fallback when AI verification is not available
fn fallback_fill_filtered(db_path: &str, candidates: &[ContactCandidate]) {
    eprintln!("Fallback: Adding all candidates with not_clear = true");

    let conn = Connection::open(db_path).expect("failed to open database");
    db::setup_filtered_contacts_table(&conn);

    conn.execute_batch("BEGIN TRANSACTION").unwrap();

    let mut insert_stmt = conn
        .prepare(
            "INSERT INTO contacts_filtered (name, email, received, sent, sent_per_month, received_per_month, average_chars, duration, meetings, not_clear) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .unwrap();

    let mut count = 0u64;

    for candidate in candidates {
        if insert_stmt
            .execute(params![
                candidate.name,
                candidate.email,
                candidate.received,
                candidate.sent,
                candidate.sent_per_month,
                candidate.received_per_month,
                candidate.average_chars,
                candidate.duration,
                candidate.meetings,
                1 // not_clear = true (no AI verification)
            ])
            .is_ok()
        {
            count += 1;
        }
    }

    drop(insert_stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!("Fallback: {} contacts added to filtered (all with not_clear=1)", count);
}