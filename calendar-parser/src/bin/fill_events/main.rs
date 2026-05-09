mod db;
mod models;
mod parsing;
mod recurrence;

use std::env;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::Connection;

use db::{insert_event, setup_events_db, InsertCounts, INSERT_SQL};
use parsing::{extract_events, unfold_lines};

const DEFAULT_DB: &str = "data/contacts.db";
const DEFAULT_CALENDAR_DIR: &str = "data/Calendar";
const SAFETY_CAP: usize = 10_000;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let (inputs, db_path) = parse_args(env::args().skip(1).collect());

    let inputs: Vec<String> = if inputs.is_empty() {
        vec![DEFAULT_CALENDAR_DIR.to_string()]
    } else {
        inputs
    };

    let ics_files = expand_inputs(&inputs);

    if ics_files.is_empty() {
        eprintln!("Usage: fill_events <ics_file_or_dir> [...] [--db <path>]");
        eprintln!("No .ics files found in: {:?}", inputs);
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
        if args[i] == "--db" && i + 1 < args.len() {
            db_path = args[i + 1].clone();
            i += 2;
            continue;
        }
        ics_files.push(args[i].clone());
        i += 1;
    }
    (ics_files, db_path)
}

/// Expand each input: pass through files, scan directories for `*.ics` (case-insensitive).
/// Missing paths are logged and skipped. Output is sorted for deterministic order.
fn expand_inputs(inputs: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for input in inputs {
        let p = Path::new(input);
        if p.is_dir() {
            match fs::read_dir(p) {
                Ok(entries) => {
                    let mut found: Vec<PathBuf> = entries
                        .filter_map(|e| e.ok().map(|e| e.path()))
                        .filter(|path| {
                            path.is_file()
                                && path
                                    .extension()
                                    .and_then(|s| s.to_str())
                                    .map(|s| s.eq_ignore_ascii_case("ics"))
                                    .unwrap_or(false)
                        })
                        .collect();
                    found.sort();
                    for f in found {
                        if let Some(s) = f.to_str() {
                            out.push(s.to_string());
                        }
                    }
                }
                Err(e) => eprintln!("[warn] cannot read directory {}: {}", input, e),
            }
        } else if p.is_file() {
            out.push(input.clone());
        } else {
            eprintln!("[warn] not a file or directory: {}", input);
        }
    }
    out
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

    #[test]
    fn expand_inputs_scans_directory_for_ics_files() {
        let dir = std::env::temp_dir().join("fill_events_expand_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.ics"), "").unwrap();
        fs::write(dir.join("b.ICS"), "").unwrap(); // case-insensitive
        fs::write(dir.join("c.txt"), "").unwrap(); // ignored
        fs::write(dir.join("d.json"), "").unwrap(); // ignored

        let dir_str = dir.to_str().unwrap().to_string();
        let out = expand_inputs(&[dir_str]);
        assert_eq!(out.len(), 2);
        assert!(out.iter().any(|p| p.ends_with("a.ics")));
        assert!(out.iter().any(|p| p.ends_with("b.ICS")));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn expand_inputs_passes_through_files() {
        let file = std::env::temp_dir().join("fill_events_expand_passthrough.ics");
        fs::write(&file, "").unwrap();
        let s = file.to_str().unwrap().to_string();
        let out = expand_inputs(&[s.clone()]);
        assert_eq!(out, vec![s]);
        fs::remove_file(&file).unwrap();
    }
}
