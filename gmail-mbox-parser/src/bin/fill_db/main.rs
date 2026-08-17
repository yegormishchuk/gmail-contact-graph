mod content;
mod db;
mod meetings;
mod models;
mod parsing;
mod spam;

use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader};

use rusqlite::{params, Connection};

use gmail_mbox_parser::hf::{ContactForVerification, HFClient, HFConfig};
use models::{ContactStats, EmailMessage, ParseState};
use spam::is_spam_contact;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const DEFAULT_DB_PATH: &str = "data/contacts.db";
const USAGE: &str = "Usage: fill_db <mbox_file> [user_email] [db_path]";

/// Splits the positional arguments into `(mbox_path, user_email, db_path)`.
///
/// The email is optional on the command line so it can come from `USER_EMAIL`
/// in the environment instead, matching `fill_events`. An argument is read as
/// the email only if it contains '@', which keeps `<mbox> <db>` unambiguous.
fn parse_args(args: &[String]) -> Option<(&str, Option<&str>, &str)> {
    let mbox_path = args.first()?;
    let mut user_email = None;
    let mut db_path = DEFAULT_DB_PATH;

    for arg in &args[1..] {
        if user_email.is_none() && arg.contains('@') {
            user_email = Some(arg.as_str());
        } else {
            db_path = arg.as_str();
        }
    }

    Some((mbox_path.as_str(), user_email, db_path))
}

#[tokio::main]
async fn main() {
    // Load the single project-root .env (binary is invoked from gmail-mbox-parser/).
    // Fall back to CWD .env in case it's run from the repo root.
    let _ = dotenvy::from_path("../.env").or_else(|_| dotenvy::from_path(".env"));

    let args: Vec<String> = env::args().skip(1).collect();

    let (mbox_path, email_arg, db_path) = match parse_args(&args) {
        Some(parsed) => parsed,
        None => {
            eprintln!("{}", USAGE);
            std::process::exit(1);
        }
    };

    let user_email = match email_arg
        .map(str::to_string)
        .or_else(|| env::var("USER_EMAIL").ok())
        .map(|email| email.trim().to_lowercase())
        .filter(|email| !email.is_empty())
    {
        Some(email) => email,
        None => {
            eprintln!("{}", USAGE);
            eprintln!("No user email: pass it as an argument or set USER_EMAIL in ../.env");
            std::process::exit(1);
        }
    };

    eprintln!("     mbox: {}", mbox_path);
    eprintln!("user_email: {}", user_email);
    eprintln!("       db: {}", db_path);

    // Phase 1: Fill mails table
    let contact_stats = fill_mails_db(mbox_path, &user_email, db_path);

    // Phase 2: Fill contacts table from accumulated statistics
    fill_contacts_db(&contact_stats, db_path);

    // Phase 3: Mark non-spam contacts (basic spam filter)
    let candidates = fill_candidates_db(db_path);

    // Phase 4: AI verification and fill filtered contacts table
    if !candidates.is_empty() {
        fill_filtered_with_ai(db_path, candidates).await;
    } else {
        eprintln!("No candidates for AI verification.");
    }

    // Merge WAL into the main DB file so non-WAL readers (e.g. sql.js in the
    // webapp) see the latest state instead of a stale pre-WAL snapshot.
    let conn = Connection::open(db_path).expect("failed to open database");
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE);", [], |_| Ok(()))
        .expect("wal_checkpoint failed");
}

// ---------------------------------------------------------------------------
// Phase 1: Fill mails table
// ---------------------------------------------------------------------------

fn fill_mails_db(
    mbox_path: &str,
    user_email: &str,
    db_path: &str,
) -> HashMap<String, ContactStats> {
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
                    let result =
                        db::insert_message(&mut stmt, &msg, user_email, &mut contact_stats);
                    row_count += result.0;
                    if result.1 {
                        skipped_count += 1;
                    }
                    msg_count += 1;
                    if msg_count.is_multiple_of(5000) {
                        eprintln!(
                            "[progress] {} messages, {} rows, {} skipped",
                            msg_count, row_count, skipped_count
                        );
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

    eprintln!(
        "Mails DB: {} messages, {} rows inserted, {} skipped.",
        msg_count, row_count, skipped_count
    );

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
        let (sent_per_month, received_per_month) =
            match (stats.first_timestamp, stats.last_timestamp) {
                (Some(first), Some(last)) => (
                    Some(parsing::calculate_emails_per_month(first, last, stats.sent)),
                    Some(parsing::calculate_emails_per_month(
                        first,
                        last,
                        stats.received,
                    )),
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
// Phase 3: Mark non-spam contacts (basic spam filter)
// ---------------------------------------------------------------------------

/// Contact candidate — references a row in the `contacts` table
#[derive(Clone)]
struct ContactCandidate {
    id: i64,
    email: String,
    name: String,
    received: u32,
    sent: u32,
}

fn fill_candidates_db(db_path: &str) -> Vec<ContactCandidate> {
    let conn = Connection::open(db_path).expect("failed to open database");

    let mut select_stmt = conn
        .prepare("SELECT id, email, name, received, sent FROM contacts")
        .unwrap();

    let mut update_stmt = conn
        .prepare("UPDATE contacts SET not_spam = 1 WHERE id = ?1")
        .unwrap();

    let mut total = 0u64;
    let mut kept = 0u64;
    let mut candidates = Vec::new();

    let contacts_iter = select_stmt
        .query_map([], |row| {
            Ok(ContactCandidate {
                id: row.get(0)?,
                email: row.get(1)?,
                name: row.get(2)?,
                received: row.get(3)?,
                sent: row.get(4)?,
            })
        })
        .unwrap();

    for contact_result in contacts_iter {
        let candidate = match contact_result {
            Ok(c) => c,
            Err(_) => continue,
        };

        total += 1;

        if is_spam_contact(
            &candidate.email,
            &candidate.name,
            candidate.received,
            candidate.sent,
        ) {
            continue;
        }

        if update_stmt.execute(params![candidate.id]).is_ok() {
            candidates.push(candidate);
            kept += 1;
        }
    }

    drop(select_stmt);
    drop(update_stmt);

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
        .prepare("INSERT INTO contacts_filtered (contact_id, not_clear) VALUES (?1, ?2)")
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
                if insert_stmt.execute(params![candidate.id, 0]).is_ok() {
                    human_count += 1;
                }
            }
            _ => {
                // Unknown/unclear - add with not_clear = true
                if insert_stmt.execute(params![candidate.id, 1]).is_ok() {
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
        .prepare("INSERT INTO contacts_filtered (contact_id, not_clear) VALUES (?1, ?2)")
        .unwrap();

    let mut count = 0u64;

    for candidate in candidates {
        if insert_stmt.execute(params![candidate.id, 1]).is_ok() {
            count += 1;
        }
    }

    drop(insert_stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!(
        "Fallback: {} contacts added to filtered (all with not_clear=1)",
        count
    );
}
#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_the_full_makefile_form() {
        let args = args(&["../data/data.mbox", "you@gmail.com", "../data/contacts.db"]);
        let (mbox, email, db) = parse_args(&args).unwrap();
        assert_eq!(mbox, "../data/data.mbox");
        assert_eq!(email, Some("you@gmail.com"));
        assert_eq!(db, "../data/contacts.db");
    }

    #[test]
    fn omitted_email_leaves_the_db_path_in_place() {
        let args = args(&["../data/data.mbox", "../data/contacts.db"]);
        let (mbox, email, db) = parse_args(&args).unwrap();
        assert_eq!(mbox, "../data/data.mbox");
        assert_eq!(email, None);
        assert_eq!(db, "../data/contacts.db");
    }

    #[test]
    fn mbox_alone_falls_back_to_the_default_db() {
        let args = args(&["../data/data.mbox"]);
        let (mbox, email, db) = parse_args(&args).unwrap();
        assert_eq!(mbox, "../data/data.mbox");
        assert_eq!(email, None);
        assert_eq!(db, DEFAULT_DB_PATH);
    }

    #[test]
    fn no_arguments_is_rejected() {
        assert!(parse_args(&[]).is_none());
    }
}
