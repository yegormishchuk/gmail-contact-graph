//! Progress reporting.
//!
//! By default the parser prints human-readable `[progress]` lines. With
//! `PROGRESS_FORMAT=json` it prints one JSON object per line on stderr instead,
//! so the webapp can drive a progress bar. It is an environment variable rather
//! than a flag because `parse_args` reads any argument without '@' as the DB
//! path. Every other stderr line is left as it is in both modes.

use std::time::{Duration, Instant};

use serde_json::json;

const TEXT_EVERY_MESSAGES: u64 = 5000;
const JSON_EVERY_MESSAGES: u64 = 1000;
const JSON_MIN_INTERVAL: Duration = Duration::from_millis(250);

pub struct Reporter {
    json: bool,
    last_json: Option<Instant>,
}

impl Reporter {
    pub fn new(json: bool) -> Self {
        Reporter {
            json,
            last_json: None,
        }
    }

    pub fn from_env() -> Self {
        let json = std::env::var("PROGRESS_FORMAT")
            .map(|v| v.trim().eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        Reporter::new(json)
    }

    pub fn phase(&self, phase: &str) {
        emit(self.phase_line(phase));
    }

    pub fn ai_phase(&self, enabled: bool, contacts: usize) {
        emit(self.ai_phase_line(enabled, contacts));
    }

    pub fn message_parsed(&mut self, counts: MailCounts) {
        emit(self.message_line(counts, Instant::now()));
    }

    pub fn mails_finished(&mut self, counts: MailCounts) {
        emit(self.mails_finished_line(counts, Instant::now()));
    }

    pub fn done(&self, messages: u64, contacts: i64, filtered: i64) {
        emit(self.done_line(messages, contacts, filtered));
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
        self.json.then(|| {
            json!({ "event": "done", "messages": messages, "contacts": contacts, "filtered": filtered })
                .to_string()
        })
    }
}

/// Where the mails phase stands after a message.
///
/// `bytes` is an estimate: it sums decoded line lengths plus one per newline,
/// so CRLF endings and lines that fail to decode make it drift slightly.
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
        assert_eq!(r.done_line(1, 2, 3), None);
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
}
