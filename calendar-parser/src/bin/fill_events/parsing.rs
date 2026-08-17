use crate::models::{Attendee, CalendarEvent, ParseState};
use chrono::{NaiveDate, NaiveDateTime, TimeZone, Utc};
use std::collections::HashMap;

/// Take an iterator of raw lines and return logical lines with continuations folded in.
pub fn unfold_lines<I: IntoIterator<Item = String>>(lines: I) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in lines {
        if (line.starts_with(' ') || line.starts_with('\t')) && !out.is_empty() {
            let last = out.last_mut().unwrap();
            last.push_str(&line[1..]);
        } else {
            out.push(line);
        }
    }
    out
}

/// Split an ICS property line into (NAME, params, value).
/// Returns None if no top-level colon exists.
pub fn split_property(line: &str) -> Option<(String, HashMap<String, String>, String)> {
    // Find the first colon NOT inside double quotes.
    let mut in_quotes = false;
    let mut colon_pos = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                colon_pos = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon_pos?;
    let head = &line[..colon];
    let value = line[colon + 1..].to_string();

    let mut parts = head.split(';');
    let name = parts.next()?.to_string();

    let mut params: HashMap<String, String> = HashMap::new();
    for p in parts {
        if let Some(eq) = p.find('=') {
            let k = p[..eq].to_string();
            let v = p[eq + 1..].trim_matches('"').to_string();
            params.insert(k, v);
        }
    }
    Some((name, params, value))
}

/// Parse an ICS date/datetime value to a Unix timestamp (UTC seconds).
pub fn parse_ics_date(raw: &str) -> Option<i64> {
    let s = raw.trim();
    // YYYYMMDDTHHMMSSZ
    if s.len() == 16 && s.ends_with('Z') {
        let dt = NaiveDateTime::parse_from_str(&s[..15], "%Y%m%dT%H%M%S").ok()?;
        return Some(Utc.from_utc_datetime(&dt).timestamp());
    }
    // YYYYMMDDTHHMMSS (floating, treat as UTC)
    if s.len() == 15 {
        let dt = NaiveDateTime::parse_from_str(s, "%Y%m%dT%H%M%S").ok()?;
        return Some(Utc.from_utc_datetime(&dt).timestamp());
    }
    // YYYYMMDD (all-day)
    if s.len() == 8 {
        let date = NaiveDate::parse_from_str(s, "%Y%m%d").ok()?;
        let dt = date.and_hms_opt(0, 0, 0)?;
        return Some(Utc.from_utc_datetime(&dt).timestamp());
    }
    None
}

/// Unescape ICS TEXT value: \n → newline, \, → comma, \; → semicolon, \\ → backslash.
pub fn unescape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.peek() {
                Some('n') | Some('N') => {
                    out.push('\n');
                    chars.next();
                }
                Some(',') => {
                    out.push(',');
                    chars.next();
                }
                Some(';') => {
                    out.push(';');
                    chars.next();
                }
                Some('\\') => {
                    out.push('\\');
                    chars.next();
                }
                _ => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Strip "mailto:" prefix from attendee/organizer value, preserving case of email.
pub fn strip_mailto(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("mailto:") {
        // Preserve original case of the address part
        value[value.len() - rest.len()..].to_string()
    } else {
        value.to_string()
    }
}

/// Build an Attendee from ICS property parameters and value.
pub fn build_attendee(params: &HashMap<String, String>, value: &str) -> Attendee {
    Attendee {
        email: strip_mailto(value).to_ascii_lowercase(),
        name: params.get("CN").cloned().unwrap_or_default(),
        role: params.get("ROLE").cloned().unwrap_or_default(),
        partstat: params.get("PARTSTAT").cloned().unwrap_or_default(),
        cutype: params.get("CUTYPE").cloned().unwrap_or_default(),
    }
}

/// Apply a single ICS property to a CalendarEvent.
pub fn apply_property(line: &str, event: &mut CalendarEvent) {
    let Some((name, params, value)) = split_property(line) else {
        return;
    };
    match name.as_str() {
        "UID" => event.uid = value,
        "SUMMARY" => event.summary = unescape_text(&value),
        "DESCRIPTION" => event.description = unescape_text(&value),
        "LOCATION" => event.location = unescape_text(&value),
        "STATUS" => event.status = value,
        "TRANSP" => event.transp = value,
        "SEQUENCE" => event.sequence = value.trim().parse().unwrap_or(0),
        "DTSTART" => event.dtstart = parse_ics_date(&value),
        "DTEND" => event.dtend = parse_ics_date(&value),
        "CREATED" => event.created = parse_ics_date(&value),
        "LAST-MODIFIED" => event.last_modified = parse_ics_date(&value),
        "RRULE" => event.rrule = value,
        "ORGANIZER" => {
            event.organizer_email = strip_mailto(&value).to_ascii_lowercase();
            event.organizer_name = params.get("CN").cloned().unwrap_or_default();
        }
        "ATTENDEE" => {
            event.attendees.push(build_attendee(&params, &value));
        }
        _ => {}
    }
}

/// Extract calendar events from an iterator of unfolded lines.
/// Detects BEGIN:VEVENT/END:VEVENT boundaries and builds CalendarEvent structs.
pub fn extract_events<I: IntoIterator<Item = String>>(
    lines: I,
    source_file: &str,
) -> Vec<CalendarEvent> {
    let mut out = Vec::new();
    let mut state = ParseState::Seeking;
    let mut current = CalendarEvent::default();

    for line in lines {
        match state {
            ParseState::Seeking => {
                if line.trim() == "BEGIN:VEVENT" {
                    current = CalendarEvent::default();
                    current.source_file = source_file.to_string();
                    state = ParseState::InEvent;
                }
            }
            ParseState::InEvent => {
                if line.trim() == "END:VEVENT" {
                    out.push(std::mem::take(&mut current));
                    state = ParseState::Seeking;
                } else {
                    apply_property(&line, &mut current);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unfold_joins_continuation_lines() {
        let input = vec![
            "DESCRIPTION:hello".to_string(),
            " world".to_string(),
            "\tagain".to_string(),
            "SUMMARY:next".to_string(),
        ];
        let out = unfold_lines(input);
        assert_eq!(out, vec!["DESCRIPTION:helloworldagain", "SUMMARY:next"]);
    }

    #[test]
    fn unfold_handles_empty_input() {
        let out = unfold_lines(Vec::<String>::new());
        assert!(out.is_empty());
    }

    #[test]
    fn unfold_ignores_leading_continuation_with_no_predecessor() {
        let input = vec![" orphan".to_string(), "REAL:x".to_string()];
        let out = unfold_lines(input);
        assert_eq!(out, vec![" orphan", "REAL:x"]);
    }

    #[test]
    fn split_property_basic() {
        let (name, params, value) = split_property("SUMMARY:Hello world").unwrap();
        assert_eq!(name, "SUMMARY");
        assert!(params.is_empty());
        assert_eq!(value, "Hello world");
    }

    #[test]
    fn split_property_with_params() {
        let (name, params, value) = split_property(
            "ATTENDEE;CN=Foo Bar;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL:mailto:foo@x.com",
        )
        .unwrap();
        assert_eq!(name, "ATTENDEE");
        assert_eq!(params.get("CN"), Some(&"Foo Bar".to_string()));
        assert_eq!(params.get("ROLE"), Some(&"REQ-PARTICIPANT".to_string()));
        assert_eq!(value, "mailto:foo@x.com");
    }

    #[test]
    fn split_property_handles_quoted_param_with_colon() {
        let (name, params, value) = split_property("X-FOO;CN=\"a:b\":value").unwrap();
        assert_eq!(name, "X-FOO");
        assert_eq!(params.get("CN"), Some(&"a:b".to_string()));
        assert_eq!(value, "value");
    }

    #[test]
    fn split_property_returns_none_for_no_colon() {
        assert!(split_property("BEGIN:VEVENT").is_some());
        assert!(split_property("malformed").is_none());
    }

    #[test]
    fn parse_ics_date_utc() {
        // 2024-09-17T18:00:00Z = 1726596000
        let ts = parse_ics_date("20240917T180000Z").unwrap();
        assert_eq!(ts, 1726596000);
    }

    #[test]
    fn parse_ics_date_floating_treated_as_utc() {
        let ts = parse_ics_date("20240917T180000").unwrap();
        assert_eq!(ts, 1726596000);
    }

    #[test]
    fn parse_ics_date_all_day_is_midnight_utc() {
        // 2024-09-17T00:00:00Z = 1726531200
        let ts = parse_ics_date("20240917").unwrap();
        assert_eq!(ts, 1726531200);
    }

    #[test]
    fn parse_ics_date_returns_none_for_garbage() {
        assert!(parse_ics_date("not-a-date").is_none());
        assert!(parse_ics_date("").is_none());
    }

    #[test]
    fn unescape_text_handles_all_escapes() {
        let s = unescape_text("hello\\nworld\\, ok\\; done\\\\end");
        assert_eq!(s, "hello\nworld, ok; done\\end");
    }

    #[test]
    fn unescape_text_passes_through_plain() {
        assert_eq!(unescape_text("nothing here"), "nothing here");
    }

    #[test]
    fn unescape_text_handles_trailing_backslash() {
        assert_eq!(unescape_text("end\\"), "end\\");
    }

    #[test]
    fn strip_mailto_removes_prefix() {
        assert_eq!(strip_mailto("mailto:foo@x.com"), "foo@x.com");
        assert_eq!(strip_mailto("MAILTO:Foo@X.com"), "Foo@X.com");
        assert_eq!(strip_mailto("foo@x.com"), "foo@x.com");
    }

    #[test]
    fn build_attendee_extracts_fields() {
        let mut params = std::collections::HashMap::new();
        params.insert("CN".to_string(), "Foo Bar".to_string());
        params.insert("ROLE".to_string(), "REQ-PARTICIPANT".to_string());
        params.insert("PARTSTAT".to_string(), "ACCEPTED".to_string());
        params.insert("CUTYPE".to_string(), "INDIVIDUAL".to_string());

        let a: Attendee = build_attendee(&params, "mailto:foo@x.com");
        assert_eq!(a.email, "foo@x.com");
        assert_eq!(a.name, "Foo Bar");
        assert_eq!(a.role, "REQ-PARTICIPANT");
        assert_eq!(a.partstat, "ACCEPTED");
        assert_eq!(a.cutype, "INDIVIDUAL");
    }

    #[test]
    fn build_attendee_handles_missing_params() {
        let params = std::collections::HashMap::new();
        let a = build_attendee(&params, "mailto:bare@x.com");
        assert_eq!(a.email, "bare@x.com");
        assert!(a.name.is_empty());
        assert!(a.role.is_empty());
    }

    #[test]
    fn apply_property_sets_summary() {
        let mut e = CalendarEvent::default();
        apply_property("SUMMARY:My event", &mut e);
        assert_eq!(e.summary, "My event");
    }

    #[test]
    fn apply_property_sets_dtstart() {
        let mut e = CalendarEvent::default();
        apply_property("DTSTART:20240917T180000Z", &mut e);
        assert_eq!(e.dtstart, Some(1726596000));
    }

    #[test]
    fn apply_property_unescapes_description() {
        let mut e = CalendarEvent::default();
        apply_property("DESCRIPTION:hello\\nworld\\, ok", &mut e);
        assert_eq!(e.description, "hello\nworld, ok");
    }

    #[test]
    fn apply_property_collects_attendees() {
        let mut e = CalendarEvent::default();
        apply_property(
            "ATTENDEE;CN=Foo;ROLE=REQ-PARTICIPANT:mailto:Foo@X.com",
            &mut e,
        );
        apply_property("ATTENDEE;CN=Bar:mailto:bar@x.com", &mut e);
        assert_eq!(e.attendees.len(), 2);
        assert_eq!(e.attendees[0].email, "foo@x.com");
        assert_eq!(e.attendees[0].name, "Foo");
        assert_eq!(e.attendees[1].email, "bar@x.com");
    }

    #[test]
    fn apply_property_sets_organizer() {
        let mut e = CalendarEvent::default();
        apply_property("ORGANIZER;CN=Me:mailto:me@x.com", &mut e);
        assert_eq!(e.organizer_email, "me@x.com");
        assert_eq!(e.organizer_name, "Me");
    }

    #[test]
    fn apply_property_sets_rrule() {
        let mut e = CalendarEvent::default();
        apply_property("RRULE:FREQ=WEEKLY;BYDAY=MO", &mut e);
        assert_eq!(e.rrule, "FREQ=WEEKLY;BYDAY=MO");
    }

    #[test]
    fn extract_events_finds_two_events() {
        use crate::models::CalendarEvent;
        let lines: Vec<String> = vec![
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "BEGIN:VEVENT",
            "UID:abc@example.com",
            "SUMMARY:First",
            "DTSTART:20240101T120000Z",
            "END:VEVENT",
            "BEGIN:VEVENT",
            "UID:def@example.com",
            "SUMMARY:Second",
            "DTSTART:20240202T120000Z",
            "END:VEVENT",
            "END:VCALENDAR",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let events: Vec<CalendarEvent> = extract_events(lines, "test.ics");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].uid, "abc@example.com");
        assert_eq!(events[0].summary, "First");
        assert_eq!(events[0].source_file, "test.ics");
        assert_eq!(events[1].uid, "def@example.com");
        assert_eq!(events[1].summary, "Second");
    }

    #[test]
    fn extract_events_empty_calendar_returns_empty() {
        let lines: Vec<String> = vec!["BEGIN:VCALENDAR", "END:VCALENDAR"]
            .into_iter()
            .map(String::from)
            .collect();
        let events = extract_events(lines, "test.ics");
        assert!(events.is_empty());
    }
}
