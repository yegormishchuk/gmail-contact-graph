//! Progress reporting.
//!
//! By default the parser prints human-readable `[progress]` lines. With
//! `PROGRESS_FORMAT=json` it prints one JSON object per line on stderr instead,
//! so the webapp can drive a progress bar. It is an environment variable rather
//! than a flag because `parse_args` reads any argument without '@' as the DB
//! path. Every other stderr line is left as it is in both modes.
//!
//! It also times each stage. In JSON mode the `done` event carries the
//! timings and the webapp records them; in text mode they are printed as a
//! table and appended to `benchmarks/timings.jsonl` next to the database.

use std::cell::Cell;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

const TEXT_EVERY_MESSAGES: u64 = 5000;
const JSON_EVERY_MESSAGES: u64 = 1000;
const JSON_MIN_INTERVAL: Duration = Duration::from_millis(250);

pub struct Reporter {
    json: bool,
    last_json: Option<Instant>,
    started: Instant,
    stage: Option<(&'static str, Instant)>,
    stages: Vec<(&'static str, Duration)>,
    total: Duration,
    ai_enabled: bool,
}

impl Reporter {
    pub fn new(json: bool) -> Self {
        Reporter::starting_at(json, Instant::now())
    }

    fn starting_at(json: bool, started: Instant) -> Self {
        Reporter {
            json,
            last_json: None,
            started,
            stage: None,
            stages: Vec::new(),
            total: Duration::ZERO,
            ai_enabled: false,
        }
    }

    pub fn from_env() -> Self {
        let json = std::env::var("PROGRESS_FORMAT")
            .map(|v| v.trim().eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        Reporter::new(json)
    }

    pub fn phase(&mut self, phase: &'static str) {
        self.start_stage(phase, Instant::now());
        emit(self.phase_line(phase));
    }

    pub fn ai_phase(&mut self, enabled: bool, contacts: usize) {
        self.ai_enabled = enabled;
        self.start_stage("ai", Instant::now());
        emit(self.ai_phase_line(enabled, contacts));
    }

    /// Starts a timed stage that the webapp is not told about.
    pub fn stage(&mut self, name: &'static str) {
        self.start_stage(name, Instant::now());
    }

    pub fn message_parsed(&mut self, counts: MailCounts) {
        emit(self.message_line(counts, Instant::now()));
    }

    pub fn mails_finished(&mut self, counts: MailCounts) {
        emit(self.mails_finished_line(counts, Instant::now()));
    }

    pub fn done(&mut self, messages: u64, contacts: i64, filtered: i64) {
        self.finish(Instant::now());
        emit(self.done_line(messages, contacts, filtered));
    }

    /// The timing record of a command-line run, for `append_record`. None in
    /// JSON mode, where the webapp writes the record.
    pub fn record_line(
        &self,
        mbox_path: &str,
        mbox_bytes: u64,
        messages: u64,
        contacts: i64,
    ) -> Option<String> {
        let mbox = Path::new(mbox_path)
            .file_name()
            .map_or(mbox_path.into(), |n| n.to_string_lossy());
        (!self.json).then(|| {
            json!({
                "mode": "cli",
                "at": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                "mbox": mbox,
                "mbox_bytes": mbox_bytes,
                "messages": messages,
                "contacts": contacts,
                "ai_enabled": self.ai_enabled,
                "stages_ms": self.stages_ms(),
                "fill_db_total_ms": millis(self.total),
            })
            .to_string()
        })
    }

    fn start_stage(&mut self, name: &'static str, now: Instant) {
        self.end_stage(now);
        self.stage = Some((name, now));
    }

    fn end_stage(&mut self, now: Instant) {
        if let Some((name, start)) = self.stage.take() {
            self.stages.push((name, now.duration_since(start)));
        }
    }

    fn finish(&mut self, now: Instant) {
        self.end_stage(now);
        self.total = now.duration_since(self.started);
    }

    fn stages_ms(&self) -> Map<String, Value> {
        self.stages
            .iter()
            .map(|(name, d)| (name.to_string(), millis(*d).into()))
            .collect()
    }

    fn phase_line(&self, phase: &str) -> Option<String> {
        self.json
            .then(|| json!({ "event": "phase", "phase": phase }).to_string())
    }

    fn ai_phase_line(&self, enabled: bool, contacts: usize) -> Option<String> {
        self.json.then(|| {
            json!({ "event": "phase", "phase": "ai", "enabled": enabled, "contacts": contacts })
                .to_string()
        })
    }

    fn message_line(&mut self, counts: MailCounts, now: Instant) -> Option<String> {
        if !self.json {
            return counts
                .messages
                .is_multiple_of(TEXT_EVERY_MESSAGES)
                .then(|| {
                    format!(
                        "[progress] {} messages, {} rows, {} skipped",
                        counts.messages, counts.rows, counts.skipped
                    )
                });
        }
        if !counts.messages.is_multiple_of(JSON_EVERY_MESSAGES) {
            return None;
        }
        if let Some(last) = self.last_json {
            if now.duration_since(last) < JSON_MIN_INTERVAL {
                return None;
            }
        }
        Some(self.progress_json(counts, now))
    }

    /// The final `progress` of the mails phase, sent regardless of throttling
    /// so a small mbox still reports its byte count at least once.
    fn mails_finished_line(&mut self, counts: MailCounts, now: Instant) -> Option<String> {
        self.json.then(|| self.progress_json(counts, now))
    }

    fn progress_json(&mut self, counts: MailCounts, now: Instant) -> String {
        self.last_json = Some(now);
        json!({
            "event": "progress",
            "phase": "mails",
            "bytes": counts.bytes,
            "total_bytes": counts.total_bytes,
            "messages": counts.messages,
        })
        .to_string()
    }

    fn done_line(&self, messages: u64, contacts: i64, filtered: i64) -> Option<String> {
        if !self.json {
            let mut table = String::from("Stage timings:");
            for (name, d) in self.stages.iter().chain([&("total", self.total)]) {
                table.push_str(&format!("\n  {:<12} {:>8.3} s", name, d.as_secs_f64()));
            }
            return Some(table);
        }
        Some(
            json!({
                "event": "done",
                "messages": messages,
                "contacts": contacts,
                "filtered": filtered,
                "stages_ms": self.stages_ms(),
                "total_ms": millis(self.total),
            })
            .to_string(),
        )
    }
}

/// Where `append_record` writes: `benchmarks/timings.jsonl` beside the database.
fn records_file(db_path: &str) -> PathBuf {
    Path::new(db_path)
        .parent()
        .unwrap_or(Path::new(""))
        .join("benchmarks")
        .join("timings.jsonl")
}

/// Appends a timing record. A failure is reported but does not fail the run.
pub fn append_record(db_path: &str, line: &str) {
    let file = records_file(db_path);
    let result = file
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file)
        })
        .and_then(|mut f| writeln!(f, "{line}"));
    match result {
        Ok(()) => eprintln!("Timings appended to {}", file.display()),
        Err(e) => eprintln!("Could not write timings to {}: {}", file.display(), e),
    }
}

fn millis(d: Duration) -> u64 {
    d.as_millis() as u64
}

/// Counts the bytes read from the inner reader.
///
/// It sits under the `BufReader`, so the count includes line endings and
/// lines that fail to decode, and runs ahead of the parser by at most one
/// buffer. At end of file it equals the file size.
pub struct CountingReader<R> {
    inner: R,
    count: Rc<Cell<u64>>,
}

impl<R> CountingReader<R> {
    /// Wraps `inner`; the returned handle reads the running count.
    pub fn new(inner: R) -> (Self, Rc<Cell<u64>>) {
        let count = Rc::new(Cell::new(0));
        let reader = CountingReader {
            inner,
            count: Rc::clone(&count),
        };
        (reader, count)
    }
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count.set(self.count.get() + n as u64);
        Ok(n)
    }
}

/// Where the mails phase stands after a message.
#[derive(Clone, Copy, Default)]
pub struct MailCounts {
    pub bytes: u64,
    pub total_bytes: u64,
    pub messages: u64,
    pub rows: u64,
    pub skipped: u64,
}

fn emit(line: Option<String>) {
    if let Some(line) = line {
        eprintln!("{}", line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn counts(messages: u64) -> MailCounts {
        MailCounts {
            bytes: messages * 10,
            total_bytes: 100_000,
            messages,
            rows: messages,
            skipped: 0,
        }
    }

    fn parse(line: &str) -> Value {
        serde_json::from_str(line).unwrap_or_else(|e| panic!("not JSON: {line}\n{e}"))
    }

    #[test]
    fn text_mode_keeps_the_old_progress_line_every_5000_messages() {
        let mut r = Reporter::new(false);
        let now = Instant::now();
        assert_eq!(r.message_line(counts(1000), now), None);
        assert_eq!(
            r.message_line(counts(5000), now).as_deref(),
            Some("[progress] 5000 messages, 5000 rows, 0 skipped")
        );
    }

    #[test]
    fn text_mode_prints_no_json() {
        let mut r = Reporter::new(false);
        let now = Instant::now();
        assert_eq!(r.phase_line("mails"), None);
        assert_eq!(r.ai_phase_line(true, 3), None);
        assert_eq!(r.mails_finished_line(counts(7), now), None);
        let done = r.done_line(1, 2, 3).unwrap();
        assert!(done.starts_with("Stage timings:"), "{done}");
    }

    #[test]
    fn json_mode_reports_every_1000_messages() {
        let mut r = Reporter::new(true);
        let start = Instant::now();
        assert_eq!(r.message_line(counts(999), start), None);
        let line = r
            .message_line(counts(1000), start)
            .expect("no progress at 1000");
        let v = parse(&line);
        assert_eq!(v["event"], "progress");
        assert_eq!(v["phase"], "mails");
        assert_eq!(v["bytes"], 10_000);
        assert_eq!(v["total_bytes"], 100_000);
        assert_eq!(v["messages"], 1000);
    }

    #[test]
    fn json_mode_is_throttled_to_one_line_per_250ms() {
        let mut r = Reporter::new(true);
        let start = Instant::now();
        assert!(r.message_line(counts(1000), start).is_some());
        assert_eq!(
            r.message_line(counts(2000), start + Duration::from_millis(100)),
            None
        );
        assert!(r
            .message_line(counts(3000), start + Duration::from_millis(300))
            .is_some());
    }

    #[test]
    fn the_end_of_the_mails_phase_always_reports_in_json_mode() {
        let mut r = Reporter::new(true);
        let start = Instant::now();
        assert!(r.message_line(counts(1000), start).is_some());
        let line = r
            .mails_finished_line(counts(1003), start)
            .expect("final progress was throttled");
        assert_eq!(parse(&line)["messages"], 1003);
    }

    #[test]
    fn counting_reader_counts_every_byte_read() {
        use std::io::{BufRead, BufReader};

        let data: &[u8] = b"one\r\ntwo\n\xff\xfe\nthree";
        let (reader, count) = CountingReader::new(data);
        let lines = BufReader::new(reader).lines().count();
        assert_eq!(lines, 4);
        assert_eq!(count.get(), data.len() as u64);
    }

    #[test]
    fn phase_ai_and_done_lines_are_json() {
        let r = Reporter::new(true);
        assert_eq!(parse(&r.phase_line("spam").unwrap())["phase"], "spam");

        let ai = parse(&r.ai_phase_line(false, 42).unwrap());
        assert_eq!(ai["phase"], "ai");
        assert_eq!(ai["enabled"], false);
        assert_eq!(ai["contacts"], 42);

        let done = parse(&r.done_line(19, 12, 7).unwrap());
        assert_eq!(done["event"], "done");
        assert_eq!(done["messages"], 19);
        assert_eq!(done["contacts"], 12);
        assert_eq!(done["filtered"], 7);
    }

    /// A run through every stage: 100 ms of mails, 50 of contacts, 10 of
    /// spam, 240 of ai and 50 of checkpoint.
    fn timed_run(json: bool) -> Reporter {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut r = Reporter::starting_at(json, t0);
        r.start_stage("mails", ms(0));
        r.start_stage("contacts", ms(100));
        r.start_stage("spam", ms(150));
        r.start_stage("ai", ms(160));
        r.start_stage("checkpoint", ms(400));
        r.finish(ms(450));
        r
    }

    #[test]
    fn each_stage_runs_until_the_next_one_starts() {
        let done = parse(&timed_run(true).done_line(19, 12, 7).unwrap());
        assert_eq!(
            done["stages_ms"],
            serde_json::json!({ "mails": 100, "contacts": 50, "spam": 10, "ai": 240, "checkpoint": 50 })
        );
        assert_eq!(done["total_ms"], 450);
    }

    #[test]
    fn text_mode_ends_with_a_table_of_stage_timings() {
        let table = timed_run(false).done_line(19, 12, 7).unwrap();
        assert!(!table.starts_with('{'), "not a table:\n{table}");
        let rows: Vec<&str> = table.lines().map(str::trim).collect();
        assert_eq!(
            rows,
            [
                "Stage timings:",
                "mails           0.100 s",
                "contacts        0.050 s",
                "spam            0.010 s",
                "ai              0.240 s",
                "checkpoint      0.050 s",
                "total           0.450 s",
            ]
        );
    }

    #[test]
    fn text_mode_writes_a_cli_timing_record() {
        let mut r = timed_run(false);
        r.ai_enabled = true;
        let line = r
            .record_line("../data/Email/all.mbox", 2048, 19, 12)
            .expect("no record in text mode");
        let v = parse(&line);
        assert_eq!(v["mode"], "cli");
        assert_eq!(v["mbox"], "all.mbox");
        assert_eq!(v["mbox_bytes"], 2048);
        assert_eq!(v["messages"], 19);
        assert_eq!(v["contacts"], 12);
        assert_eq!(v["ai_enabled"], true);
        assert_eq!(v["stages_ms"]["ai"], 240);
        assert_eq!(v["fill_db_total_ms"], 450);
        assert!(v["at"].as_str().is_some_and(|at| at.ends_with('Z')));
    }

    #[test]
    fn json_mode_leaves_the_record_to_the_webapp() {
        assert_eq!(timed_run(true).record_line("x.mbox", 1, 1, 1), None);
    }

    #[test]
    fn records_go_to_benchmarks_next_to_the_database() {
        assert_eq!(
            records_file("../data/contacts.db"),
            Path::new("../data/benchmarks/timings.jsonl")
        );
        assert_eq!(
            records_file("contacts.db"),
            Path::new("benchmarks/timings.jsonl")
        );
    }
}
