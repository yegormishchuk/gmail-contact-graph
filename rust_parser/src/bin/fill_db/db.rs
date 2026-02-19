use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::content::extract_text_content;
use crate::meetings::contains_meeting_content;
use crate::models::{ContactStats, EmailMessage};

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

pub fn setup_mails_db(conn: &Connection) {
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
             id        INTEGER PRIMARY KEY AUTOINCREMENT,
             \"from\"  TEXT NOT NULL,
             from_name TEXT NOT NULL DEFAULT '',
             \"to\"    TEXT NOT NULL,
             to_name   TEXT NOT NULL DEFAULT '',
             subject   TEXT NOT NULL DEFAULT '',
             content   TEXT NOT NULL DEFAULT '',
             date      INTEGER
         );
         CREATE INDEX IF NOT EXISTS idx_mails_from ON mails(\"from\");
         CREATE INDEX IF NOT EXISTS idx_mails_to   ON mails(\"to\");
         CREATE INDEX IF NOT EXISTS idx_mails_date ON mails(date);",
    )
    .unwrap();
}

pub fn setup_contacts_table(conn: &Connection) {
    conn.execute_batch(
        "DROP TABLE IF EXISTS contacts;
         CREATE TABLE contacts (
             id              INTEGER PRIMARY KEY AUTOINCREMENT,
             name            TEXT NOT NULL,
             email           TEXT NOT NULL UNIQUE,
             received        INTEGER NOT NULL DEFAULT 0,
             sent            INTEGER NOT NULL DEFAULT 0,
             sent_per_month  REAL,
             received_per_month REAL,
             average_chars   REAL,
             duration        REAL,
             meetings        INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);",
    )
    .unwrap();
}

pub fn setup_filtered_contacts_table(conn: &Connection) {
    conn.execute_batch(
        "DROP TABLE IF EXISTS contacts_filtered;
         CREATE TABLE contacts_filtered (
             id              INTEGER PRIMARY KEY AUTOINCREMENT,
             name            TEXT NOT NULL,
             email           TEXT NOT NULL UNIQUE,
             received        INTEGER NOT NULL DEFAULT 0,
             sent            INTEGER NOT NULL DEFAULT 0,
             sent_per_month  REAL,
             received_per_month REAL,
             average_chars   REAL,
             duration        REAL,
             meetings        INTEGER NOT NULL DEFAULT 0,
             not_clear       INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_contacts_filtered_email ON contacts_filtered(email);",
    )
    .unwrap();
}

/// Setup candidates table (contacts that passed basic spam filter, awaiting AI verification)
pub fn setup_candidates_table(conn: &Connection) {
    conn.execute_batch(
        "DROP TABLE IF EXISTS contacts_candidates;
         CREATE TABLE contacts_candidates (
             id              INTEGER PRIMARY KEY AUTOINCREMENT,
             name            TEXT NOT NULL,
             email           TEXT NOT NULL UNIQUE,
             received        INTEGER NOT NULL DEFAULT 0,
             sent            INTEGER NOT NULL DEFAULT 0,
             sent_per_month  REAL,
             received_per_month REAL,
             average_chars   REAL,
             duration        REAL,
             meetings        INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_contacts_candidates_email ON contacts_candidates(email);",
    )
    .unwrap();
}

// ---------------------------------------------------------------------------
// Insert message into database
// ---------------------------------------------------------------------------

/// Returns (rows_inserted, was_skipped)
pub fn insert_message(
    stmt: &mut rusqlite::Statement,
    msg: &EmailMessage,
    user_email: &str,
    contact_stats: &mut HashMap<String, ContactStats>,
) -> (u64, bool) {
    // Check if user is involved in this email
    let user_is_sender = msg.from_email == user_email;
    let user_is_recipient = msg.to.iter().any(|(email, _)| email == user_email);

    // Skip emails where user is not involved
    if !user_is_sender && !user_is_recipient {
        return (0, true);
    }

    let content = extract_text_content(
        &msg.body,
        &msg.content_type,
        &msg.transfer_encoding,
        &msg.charset,
        &msg.boundary,
        0,
    );

    let content_chars = content.chars().count() as u64;

    // Check if this email contains meeting-related content
    let is_meeting = contains_meeting_content(&msg.subject, &content);

    // Update contact statistics
    if user_is_sender {
        // User sent this email - update 'sent' count for all recipients
        for (recipient_email, recipient_name) in &msg.to {
            if recipient_email == user_email {
                continue; // Skip self
            }
            let stats = contact_stats.entry(recipient_email.clone()).or_default();
            stats.sent += 1;
            if stats.name.is_empty() && !recipient_name.is_empty() {
                stats.name = recipient_name.clone();
            }
            if let Some(ts) = msg.date {
                stats.update_timestamps(ts);
            }
            stats.total_chars += content_chars;
            stats.email_count += 1;
            if is_meeting {
                stats.meetings += 1;
            }
        }
    } else {
        // User received this email - update 'received' count for sender
        if !msg.from_email.is_empty() && msg.from_email != user_email {
            let stats = contact_stats.entry(msg.from_email.clone()).or_default();
            stats.received += 1;
            if stats.name.is_empty() && !msg.from_name.is_empty() {
                stats.name = msg.from_name.clone();
            }
            if let Some(ts) = msg.date {
                stats.update_timestamps(ts);
            }
            stats.total_chars += content_chars;
            stats.email_count += 1;
            if is_meeting {
                stats.meetings += 1;
            }
        }
    }

    // Insert rows into mails database - only rows involving the user
    let mut rows = 0u64;

    if user_is_sender {
        // User sent this email - insert row for each recipient (except self)
        for (recipient_email, recipient_name) in &msg.to {
            if recipient_email == user_email {
                continue;
            }
            if stmt
                .execute(params![
                    msg.from_email,
                    msg.from_name,
                    recipient_email,
                    recipient_name,
                    msg.subject,
                    content,
                    msg.date
                ])
                .is_ok()
            {
                rows += 1;
            }
        }
    } else {
        // User received this email - insert one row: sender -> user
        if stmt
            .execute(params![
                msg.from_email,
                msg.from_name,
                user_email,
                "", // user's name not stored in msg
                msg.subject,
                content,
                msg.date
            ])
            .is_ok()
        {
            rows += 1;
        }
    }

    (rows, false)
}
