//! `PROGRESS_FORMAT=json` output of the `fill_events` binary.
//!
//! The webapp starts `fill_events` itself and reads these lines from stderr to
//! show which phase an import is in.

use std::path::PathBuf;
use std::process::{Command, Output};

const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";

/// Runs the binary from inside a scratch directory, so it never reads the
/// developer's `../.env`, over one empty calendar.
fn run(case: &str, progress_format: Option<&str>) -> Output {
    let dir: PathBuf = std::env::temp_dir().join(format!(
        "fill_events_progress_{}_{}",
        case,
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("calendar.ics"), ICS).unwrap();

    let mut command = Command::new(env!("CARGO_BIN_EXE_fill_events"));
    command
        .current_dir(&dir)
        .env_remove("USER_EMAIL")
        .env_remove("PROGRESS_FORMAT")
        .args(["calendar.ics", "--db", "contacts.db"]);
    if let Some(format) = progress_format {
        command.env("PROGRESS_FORMAT", format);
    }
    let output = command.output().expect("failed to run fill_events");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        output.status.success(),
        "fill_events exited with {}\nstderr:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn json_lines(output: &Output) -> Vec<serde_json::Value> {
    String::from_utf8_lossy(&output.stderr)
        .lines()
        .filter(|l| l.starts_with('{'))
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[test]
fn json_mode_reports_the_calendar_phase_then_done() {
    let events = json_lines(&run("json", Some("json")));
    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(events[0]["event"], "phase");
    assert_eq!(events[0]["phase"], "calendar");
    assert_eq!(events[1]["event"], "done");
    assert_eq!(events[1]["masters"], 0);
    assert_eq!(events[1]["occurrences"], 0);
}

#[test]
fn text_mode_prints_no_json() {
    assert!(json_lines(&run("text", None)).is_empty());
}
