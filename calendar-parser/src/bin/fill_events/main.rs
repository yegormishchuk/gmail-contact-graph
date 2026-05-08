mod db;
mod models;
mod parsing;
mod recurrence;

use std::env;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use chrono::Utc;
use rusqlite::Connection;

use db::{insert_event, setup_events_db, InsertCounts, INSERT_SQL};
use parsing::{extract_events, unfold_lines};

const DEFAULT_DB: &str = "data/contacts.db";
const SAFETY_CAP: usize = 10_000;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let (ics_files, db_path) = parse_args(env::args().skip(1).collect());

    if ics_files.is_empty() {
        eprintln!("Usage: fill_events <ics_file_1> [ics_file_2 ...] [--db <path>]");
        std::process::exit(1);
    }

    eprintln!("DB: {}", db_path);
    for f in &ics_files {
        eprintln!("ICS: {}", f);
    }

    let conn = Connection::open(&db_path).expect("failed to open database");
    setup_events_db(&conn);

    let today_cutoff = Utc::now().timestamp();

    conn.execute_batch("BEGIN TRANSACTION").unwrap();
    let mut stmt = conn.prepare(INSERT_SQL).unwrap();

    let mut totals = InsertCounts { masters: 0, occurrences: 0, skipped_unsupported: 0 };

    for path in &ics_files {
        let file = match File::open(path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("[warn] cannot open {}: {}", path, e);
                continue;
            }
        };
        let reader = BufReader::new(file);
        let raw_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
        let unfolded = unfold_lines(raw_lines);

        let source_name = Path::new(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(path);

        let events = extract_events(unfolded.into_iter(), source_name);
        eprintln!("[file] {}: {} events parsed", source_name, events.len());

        for event in &events {
            let counts = insert_event(&mut stmt, event, today_cutoff, SAFETY_CAP);
            totals.masters += counts.masters;
            totals.occurrences += counts.occurrences;
            totals.skipped_unsupported += counts.skipped_unsupported;
        }
    }

    drop(stmt);
    conn.execute_batch("COMMIT").unwrap();

    eprintln!(
        "Events: {} masters, {} occurrences, {} skipped (unsupported RRULE).",
        totals.masters, totals.occurrences, totals.skipped_unsupported
    );
}

fn parse_args(args: Vec<String>) -> (Vec<String>, String) {
    let mut ics_files: Vec<String> = Vec::new();
    let mut db_path = DEFAULT_DB.to_string();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--db" {
            if i + 1 < args.len() {
                db_path = args[i + 1].clone();
                i += 2;
                continue;
            }
        }
        ics_files.push(args[i].clone());
        i += 1;
    }
    (ics_files, db_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_args_collects_files_and_db() {
        let (files, db) = parse_args(vec![
            "a.ics".into(),
            "b.ics".into(),
            "--db".into(),
            "out.db".into(),
        ]);
        assert_eq!(files, vec!["a.ics", "b.ics"]);
        assert_eq!(db, "out.db");
    }

    #[test]
    fn parse_args_default_db() {
        let (files, db) = parse_args(vec!["a.ics".into()]);
        assert_eq!(files, vec!["a.ics"]);
        assert_eq!(db, "data/contacts.db");
    }
}
