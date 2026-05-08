use std::collections::HashMap;
use chrono::{NaiveDate, NaiveDateTime, TimeZone, Utc};

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
        let (name, params, value) =
            split_property("X-FOO;CN=\"a:b\":value").unwrap();
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
}
