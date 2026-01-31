mod content;
mod db;
mod models;
mod parsing;

use std::collections::HashMap;
use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader};

use rusqlite::{params, Connection};

use models::{ContactStats, EmailMessage, ParseState};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 3 {
        eprintln!("Usage: fill_db <mbox_file> <user_email> [mails_db_path] [contacts_db_path]");
        std::process::exit(1);
    }

    let mbox_path = &args[1];
    let user_email = args[2].to_lowercase();
    let mails_db_path = args.get(3).map(|s| s.as_str()).unwrap_or("data/mails.db");
    let contacts_db_path = args.get(4).map(|s| s.as_str()).unwrap_or("data/contacts.db");

    eprintln!("     mbox: {}", mbox_path);
    eprintln!("user_email: {}", user_email);
    eprintln!(" mails db: {}", mails_db_path);
    eprintln!("contacts db: {}", contacts_db_path);

    // Phase 1: Fill mails.db
    let contact_stats = fill_mails_db(mbox_path, &user_email, mails_db_path);

    // Phase 2: Fill contacts.db from accumulated statistics
    fill_contacts_db(&contact_stats, contacts_db_path);

    // Phase 3: Fill filtered contacts table (without spam)
    fill_filtered_contacts_db(contacts_db_path);
}

// ---------------------------------------------------------------------------
// Phase 1: Fill mails database
// ---------------------------------------------------------------------------

fn fill_mails_db(mbox_path: &str, user_email: &str, db_path: &str) -> HashMap<String, ContactStats> {
    let conn = Connection::open(db_path).expect("failed to open mails database");
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
// Phase 2: Fill contacts database
// ---------------------------------------------------------------------------

fn fill_contacts_db(contact_stats: &HashMap<String, ContactStats>, db_path: &str) {
    let conn = Connection::open(db_path).expect("failed to open contacts database");
    db::setup_contacts_db(&conn);

    conn.execute_batch("BEGIN TRANSACTION").unwrap();
    let mut stmt = conn
        .prepare(
            "INSERT INTO contacts (name, email, received, sent, sent_per_month, received_per_month, average_chars, duration) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
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
                duration
            ])
            .is_ok()
        {
            inserted += 1;
        }
    }

    drop(stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!("Contacts DB: {} contacts inserted.", inserted);
}

// ---------------------------------------------------------------------------
// Phase 3: Fill filtered contacts table (without spam)
// ---------------------------------------------------------------------------

fn fill_filtered_contacts_db(db_path: &str) {
    let conn = Connection::open(db_path).expect("failed to open contacts database");
    db::setup_filtered_contacts_table(&conn);

    conn.execute_batch("BEGIN TRANSACTION").unwrap();

    // Query all contacts and filter out spam
    let mut select_stmt = conn
        .prepare(
            "SELECT name, email, received, sent, sent_per_month, received_per_month, average_chars, duration \
             FROM contacts",
        )
        .unwrap();

    let mut insert_stmt = conn
        .prepare(
            "INSERT INTO contacts_filtered (name, email, received, sent, sent_per_month, received_per_month, average_chars, duration) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .unwrap();

    let mut total = 0u64;
    let mut filtered = 0u64;

    let contacts_iter = select_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,      // name
                row.get::<_, String>(1)?,      // email
                row.get::<_, u32>(2)?,         // received
                row.get::<_, u32>(3)?,         // sent
                row.get::<_, Option<f64>>(4)?, // sent_per_month
                row.get::<_, Option<f64>>(5)?, // received_per_month
                row.get::<_, Option<f64>>(6)?, // average_chars
                row.get::<_, Option<f64>>(7)?, // duration
            ))
        })
        .unwrap();

    for contact_result in contacts_iter {
        let (name, email, received, sent, sent_per_month, received_per_month, average_chars, duration) =
            match contact_result {
                Ok(c) => c,
                Err(_) => continue,
            };

        total += 1;

        // TODO: Add spam detection logic here
        // Possible criteria to check:
        // - No-reply addresses (noreply@, no-reply@, donotreply@)
        // - Automated senders (mailer-daemon@, postmaster@)
        // - Marketing/newsletter patterns (newsletter@, marketing@, promo@)
        // - One-way communication (received > 0 && sent == 0, especially high volume)
        // - Domain blocklist (known spam domains)
        // - Low engagement ratio (many received, zero replies)
        // - Suspicious patterns in name (all caps, excessive punctuation)
        let is_spam = false; // Placeholder - will be implemented later

        if is_spam {
            continue;
        }

        if insert_stmt
            .execute(params![
                name,
                email,
                received,
                sent,
                sent_per_month,
                received_per_month,
                average_chars,
                duration
            ])
            .is_ok()
        {
            filtered += 1;
        }
    }

    drop(select_stmt);
    drop(insert_stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!(
        "Filtered Contacts: {} total, {} kept, {} removed as spam.",
        total,
        filtered,
        total - filtered
    );
}