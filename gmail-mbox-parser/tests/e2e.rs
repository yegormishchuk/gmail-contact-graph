//! End-to-end run of the `fill_db` binary over a synthetic mbox.
//!
//! Everything the parser touches lives under a temporary directory and every
//! address is invented, so this test needs no Google Takeout export and makes
//! no network calls. It is the only check that the mbox state machine, the
//! header parsing, the statistics and the spam filter still work as one piece.

use std::path::{Path, PathBuf};
use std::process::Command;

use rusqlite::Connection;

const USER: &str = "you@example.com";

/// A run of the binary: the resulting database plus its scratch directory.
struct Run {
    conn: Connection,
    dir: PathBuf,
}

impl Drop for Run {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Run {
    fn count(&self, sql: &str) -> i64 {
        self.conn
            .query_row(sql, [], |r| r.get(0))
            .unwrap_or_else(|e| panic!("query failed: {sql}\n{e}"))
    }
}

/// Runs `fill_db` over the fixture.
///
/// The binary is launched from inside the temp directory on purpose: it reads
/// configuration from `../.env` relative to its working directory, so starting
/// it in a scratch directory keeps the developer's real `.env` out of reach.
/// That matters beyond tidiness — an `HF_API_KEY` picked up from there would
/// send contact names and addresses to Hugging Face during a test run.
fn run_fill_db(case: &str) -> Run {
    run_fill_db_into(case, "contacts.db")
}

fn run_fill_db_into(case: &str, db_relative: &str) -> Run {
    run_fill_db_with(case, db_relative, None, None).0
}

fn fixture_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("sample.mbox")
}

/// Runs `fill_db` with `PROGRESS_FORMAT` set to `progress_format` (or removed
/// when `None`) and returns the run together with its stderr.
///
/// The input is the fixture, or `mbox` written into the scratch directory.
fn run_fill_db_with(
    case: &str,
    db_relative: &str,
    progress_format: Option<&str>,
    mbox: Option<&[u8]>,
) -> (Run, String) {
    let dir = std::env::temp_dir().join(format!("fill_db_e2e_{}_{}", case, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("failed to create temp dir");
    let db = dir.join(db_relative);

    let fixture = match mbox {
        Some(bytes) => {
            let path = dir.join("input.mbox");
            std::fs::write(&path, bytes).expect("failed to write mbox");
            path
        }
        None => fixture_path(),
    };
    assert!(fixture.is_file(), "fixture missing: {}", fixture.display());

    let mut command = Command::new(env!("CARGO_BIN_EXE_fill_db"));
    command
        .current_dir(&dir)
        .env_remove("HF_API_KEY")
        .env_remove("USER_EMAIL")
        .env_remove("PROGRESS_FORMAT")
        .arg(&fixture)
        .arg(USER)
        .arg(&db);
    if let Some(format) = progress_format {
        command.env("PROGRESS_FORMAT", format);
    }
    let output = command.output().expect("failed to run fill_db");

    assert!(
        output.status.success(),
        "fill_db exited with {}\nstderr:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(db.is_file(), "fill_db produced no database at {db:?}");

    let conn = Connection::open(&db).expect("failed to open result db");
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    (Run { conn, dir }, stderr)
}

// ---------------------------------------------------------------------------
// Shape of the output
// ---------------------------------------------------------------------------

#[test]
fn writes_every_table_into_a_single_database_file() {
    let run = run_fill_db("shape");

    // Contacts and mails share one file. The separate `mails.db` described in
    // the docs is never produced.
    let files: Vec<String> = std::fs::read_dir(&run.dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
        .collect();
    assert_eq!(files, vec!["contacts.db"], "unexpected output files");

    for table in ["mails", "contacts", "contacts_filtered"] {
        assert_eq!(
            run.count(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"
            )),
            1,
            "table {table} is missing"
        );
    }
}

#[test]
fn creates_a_missing_output_directory() {
    // The Makefile used to do this with `mkdir -p`, which fails under cmd.exe —
    // the shell GNU make falls back to on Windows when no sh is on PATH. The
    // binary now creates the directory itself, so it works from any shell and
    // when invoked directly.
    let run = run_fill_db_into("mkdir", "nested/output/contacts.db");
    assert_eq!(run.count("SELECT COUNT(*) FROM contacts"), 12);
}

#[test]
fn stores_one_mail_row_per_recipient() {
    let run = run_fill_db("rows");
    // 19 messages, two of which carry two recipients each.
    assert_eq!(run.count("SELECT COUNT(*) FROM mails"), 21);
}

// ---------------------------------------------------------------------------
// The mbox state machine
// ---------------------------------------------------------------------------

#[test]
fn an_escaped_from_line_in_the_body_does_not_split_the_message() {
    let run = run_fill_db("escaped");
    assert_eq!(
        run.count("SELECT COUNT(*) FROM mails WHERE subject = 'Quoting an older mail'"),
        1,
        "the '>From ' body line split one message into two"
    );
}

#[test]
fn folded_headers_are_joined_before_parsing() {
    let run = run_fill_db("folded");
    // `To:` is folded across two lines and holds two addresses.
    assert_eq!(
        run.count("SELECT COUNT(*) FROM mails WHERE subject = 'Folded headers'"),
        2
    );
}

// ---------------------------------------------------------------------------
// Header decoding
// ---------------------------------------------------------------------------

#[test]
fn a_base64_subject_survives_the_round_trip_to_sqlite() {
    let run = run_fill_db("subject");
    assert_eq!(
        run.count("SELECT COUNT(*) FROM mails WHERE subject = 'Привет'"),
        1,
        "the MIME encoded subject did not decode to Cyrillic"
    );
}

#[test]
fn a_missing_subject_becomes_an_empty_string_not_a_null() {
    let run = run_fill_db("nosubject");
    assert_eq!(
        run.count("SELECT COUNT(*) FROM mails WHERE subject = ''"),
        1
    );
}

#[test]
fn an_unparseable_date_is_stored_as_null() {
    let run = run_fill_db("baddate");
    assert_eq!(
        run.count("SELECT COUNT(*) FROM mails WHERE date IS NULL"),
        1
    );
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

#[test]
fn counts_traffic_in_both_directions_per_contact() {
    let run = run_fill_db("stats");
    let (received, sent): (i64, i64) = run
        .conn
        .query_row(
            "SELECT received, sent FROM contacts WHERE email = 'alice@example.com'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("alice is missing from contacts");
    assert_eq!((received, sent), (2, 1));
}

#[test]
fn a_cc_recipient_is_credited_like_a_to_recipient() {
    let run = run_fill_db("cc");
    assert_eq!(
        run.count("SELECT sent FROM contacts WHERE email = 'carol@example.org'"),
        1,
        "the Cc'd contact was not credited"
    );
}

#[test]
fn a_meeting_link_in_the_body_is_counted() {
    let run = run_fill_db("meetings");
    assert_eq!(
        run.count("SELECT meetings FROM contacts WHERE email = 'alice@example.com'"),
        1,
        "the Zoom link was not detected"
    );
}

// ---------------------------------------------------------------------------
// Spam filtering
// ---------------------------------------------------------------------------

#[test]
fn two_way_correspondents_reach_the_filtered_table() {
    let run = run_fill_db("kept");
    for email in [
        "alice@example.com",
        "bob@example.com",
        "carol@example.org",
        "erin@example.com",
        "frank@example.com",
        "grace@example.com",
        "john@example.com",
    ] {
        assert_eq!(
            run.count(&format!(
                "SELECT COUNT(*) FROM contacts_filtered f
                 JOIN contacts c ON c.id = f.contact_id
                 WHERE c.email = '{email}'"
            )),
            1,
            "{email} should have survived filtering"
        );
    }
}

#[test]
fn automated_and_one_way_senders_are_filtered_out() {
    let run = run_fill_db("dropped");
    for (email, why) in [
        ("noreply@shop.example", "no-reply address"),
        ("weekly@sendgrid.net", "blocked ESP domain"),
        ("winner@example.net", "all-caps display name"),
        ("dave@example.com", "one-way traffic"),
    ] {
        assert_eq!(
            run.count(&format!(
                "SELECT COUNT(*) FROM contacts_filtered f
                 JOIN contacts c ON c.id = f.contact_id
                 WHERE c.email = '{email}'"
            )),
            0,
            "{email} should have been filtered out ({why})"
        );
    }
}

#[test]
fn without_an_api_key_every_survivor_is_marked_unclear() {
    let run = run_fill_db("fallback");
    // AI verification is skipped, so nothing is classified as definitely human:
    // all seven two-way contacts land in the table flagged as unclear.
    assert_eq!(run.count("SELECT COUNT(*) FROM contacts_filtered"), 7);
    assert_eq!(
        run.count("SELECT COUNT(*) FROM contacts_filtered WHERE not_clear = 1"),
        7
    );
}

// ---------------------------------------------------------------------------
// Machine-readable progress (PROGRESS_FORMAT=json)
// ---------------------------------------------------------------------------

fn json_events(stderr: &str) -> Vec<serde_json::Value> {
    stderr
        .lines()
        .filter(|l| l.starts_with('{'))
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("bad JSON line: {l}\n{e}")))
        .collect()
}

fn phases(events: &[serde_json::Value]) -> Vec<&str> {
    events
        .iter()
        .filter(|e| e["event"] == "phase")
        .map(|e| e["phase"].as_str().unwrap())
        .collect()
}

fn last_progress(events: Vec<serde_json::Value>) -> serde_json::Value {
    events
        .into_iter()
        .rev()
        .find(|e| e["event"] == "progress")
        .expect("no progress event")
}

#[test]
fn json_progress_reports_phases_in_order_and_ends_with_done() {
    let (_run, stderr) = run_fill_db_with("json_phases", "contacts.db", Some("json"), None);
    let events = json_events(&stderr);

    assert_eq!(
        phases(&events),
        ["mails", "contacts", "spam", "ai"],
        "stderr:\n{stderr}"
    );

    let ai = events
        .iter()
        .find(|e| e["phase"] == "ai" && e["event"] == "phase")
        .unwrap();
    assert_eq!(ai["enabled"], false, "HF_API_KEY is removed for tests");
    assert_eq!(ai["contacts"], 7);

    let done = events.last().expect("no JSON events");
    assert_eq!(done["event"], "done");
    assert_eq!(done["messages"], 19);
    assert_eq!(done["contacts"], 12);
    assert_eq!(done["filtered"], 7);
}

#[test]
fn json_progress_reports_the_byte_count_of_a_small_mbox() {
    // The fixture holds far fewer than 1000 messages, so the only progress
    // event is the one sent when the mails phase finishes.
    let (_run, stderr) = run_fill_db_with("json_bytes", "contacts.db", Some("json"), None);
    let size = std::fs::metadata(fixture_path()).unwrap().len();

    let last = last_progress(json_events(&stderr));
    assert_eq!(last["phase"], "mails");
    assert_eq!(last["total_bytes"], size);
    assert_eq!(last["bytes"], size);
    assert_eq!(last["messages"], 19);
}

#[test]
fn json_progress_counts_crlf_and_undecodable_bytes() {
    // `lines()` strips "\r\n" and drops lines that are not UTF-8, so a count
    // built from decoded lines would stop short of the file size.
    let mut mbox = std::fs::read(fixture_path())
        .unwrap()
        .split(|&b| b == b'\n')
        .map(|line| line.to_vec())
        .collect::<Vec<_>>()
        .join(&b"\r\n"[..]);
    mbox.extend_from_slice(b"Latin-1 body line: caf\xe9\r\n");

    let (_run, stderr) = run_fill_db_with("json_crlf", "contacts.db", Some("json"), Some(&mbox));
    let last = last_progress(json_events(&stderr));
    assert_eq!(last["total_bytes"], mbox.len());
    assert_eq!(last["bytes"], mbox.len());
}

#[test]
fn json_progress_reports_the_ai_phase_even_without_candidates() {
    let (_run, stderr) = run_fill_db_with("json_empty", "contacts.db", Some("json"), Some(b""));
    let events = json_events(&stderr);

    assert_eq!(
        phases(&events),
        ["mails", "contacts", "spam", "ai"],
        "stderr:\n{stderr}"
    );
    let ai = events.iter().find(|e| e["phase"] == "ai").unwrap();
    assert_eq!(ai["enabled"], false);
    assert_eq!(ai["contacts"], 0);

    let done = events.last().unwrap();
    assert_eq!(done["event"], "done");
    assert_eq!(done["messages"], 0);
    assert_eq!(done["contacts"], 0);
    assert_eq!(done["filtered"], 0);
}

#[test]
fn without_progress_format_stderr_has_no_json() {
    let (_run, stderr) = run_fill_db_with("text", "contacts.db", None, None);
    assert!(
        !stderr.lines().any(|l| l.starts_with('{')),
        "unexpected JSON in text mode:\n{stderr}"
    );
    assert!(
        stderr.contains("Mails DB: 19 messages"),
        "stderr:\n{stderr}"
    );
}
