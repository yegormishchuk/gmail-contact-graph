use chrono::{Datelike, Duration, NaiveDateTime, TimeZone, Utc, Weekday};

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub freq: Freq,
    pub interval: u32,
    pub by_day: Vec<Weekday>,
    pub until: Option<i64>,
    pub count: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ParseRuleError {
    MissingFreq,
    UnsupportedFreq(String),
    UnsupportedKey(String),
}

pub fn parse_rule(rrule: &str) -> Result<Rule, ParseRuleError> {
    use crate::parsing::parse_ics_date;

    let mut freq: Option<Freq> = None;
    let mut interval = 1u32;
    let mut by_day: Vec<Weekday> = Vec::new();
    let mut until: Option<i64> = None;
    let mut count: Option<u32> = None;

    for part in rrule.split(';') {
        let Some(eq) = part.find('=') else { continue; };
        let key = &part[..eq];
        let val = &part[eq + 1..];
        match key {
            "FREQ" => {
                freq = Some(match val {
                    "DAILY" => Freq::Daily,
                    "WEEKLY" => Freq::Weekly,
                    "MONTHLY" => Freq::Monthly,
                    other => return Err(ParseRuleError::UnsupportedFreq(other.to_string())),
                });
            }
            "INTERVAL" => interval = val.parse().unwrap_or(1).max(1),
            "BYDAY" => {
                for d in val.split(',') {
                    if let Some(wd) = parse_weekday(d) {
                        by_day.push(wd);
                    }
                }
            }
            "UNTIL" => until = parse_ics_date(val),
            "COUNT" => count = val.parse().ok(),
            "BYSETPOS" | "BYWEEKNO" | "BYMONTHDAY" | "BYYEARDAY"
            | "BYMONTH" | "BYHOUR" | "BYMINUTE" | "BYSECOND" => {
                return Err(ParseRuleError::UnsupportedKey(key.to_string()));
            }
            _ => {}
        }
    }

    let freq = freq.ok_or(ParseRuleError::MissingFreq)?;
    Ok(Rule { freq, interval, by_day, until, count })
}

fn parse_weekday(s: &str) -> Option<Weekday> {
    // Strip optional leading numeric prefix like "+1MO"
    let s = s.trim_start_matches(|c: char| c == '+' || c == '-' || c.is_ascii_digit());
    match s {
        "MO" => Some(Weekday::Mon),
        "TU" => Some(Weekday::Tue),
        "WE" => Some(Weekday::Wed),
        "TH" => Some(Weekday::Thu),
        "FR" => Some(Weekday::Fri),
        "SA" => Some(Weekday::Sat),
        "SU" => Some(Weekday::Sun),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_weekly_byday_monday() {
        let r = parse_rule("FREQ=WEEKLY;BYDAY=MO").unwrap();
        assert_eq!(r.freq, Freq::Weekly);
        assert_eq!(r.interval, 1);
        assert_eq!(r.by_day, vec![Weekday::Mon]);
        assert_eq!(r.until, None);
        assert_eq!(r.count, None);
    }

    #[test]
    fn parse_daily_with_interval_count() {
        let r = parse_rule("FREQ=DAILY;INTERVAL=2;COUNT=10").unwrap();
        assert_eq!(r.freq, Freq::Daily);
        assert_eq!(r.interval, 2);
        assert_eq!(r.count, Some(10));
    }

    #[test]
    fn parse_with_until() {
        let r = parse_rule("FREQ=WEEKLY;UNTIL=20240101T000000Z").unwrap();
        assert_eq!(r.until, Some(1704067200));
    }

    #[test]
    fn parse_unsupported_freq_returns_err() {
        let err = parse_rule("FREQ=YEARLY").unwrap_err();
        assert_eq!(err, ParseRuleError::UnsupportedFreq("YEARLY".into()));
    }

    #[test]
    fn parse_unsupported_key_returns_err() {
        let err = parse_rule("FREQ=MONTHLY;BYSETPOS=-1").unwrap_err();
        assert_eq!(err, ParseRuleError::UnsupportedKey("BYSETPOS".into()));
    }

    #[test]
    fn parse_byday_with_numeric_prefix() {
        let r = parse_rule("FREQ=MONTHLY;BYDAY=+1MO,-1FR").unwrap();
        assert_eq!(r.by_day, vec![Weekday::Mon, Weekday::Fri]);
    }
}
