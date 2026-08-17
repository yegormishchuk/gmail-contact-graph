use chrono::Timelike;
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
        let Some(eq) = part.find('=') else {
            continue;
        };
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
            "BYSETPOS" | "BYWEEKNO" | "BYMONTHDAY" | "BYYEARDAY" | "BYMONTH" | "BYHOUR"
            | "BYMINUTE" | "BYSECOND" => {
                return Err(ParseRuleError::UnsupportedKey(key.to_string()));
            }
            _ => {}
        }
    }

    let freq = freq.ok_or(ParseRuleError::MissingFreq)?;
    Ok(Rule {
        freq,
        interval,
        by_day,
        until,
        count,
    })
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

/// Expand a recurrence rule starting at `dtstart` (Unix UTC seconds) up to `cutoff`.
/// Returns a list of occurrence timestamps including the start (when it matches BYDAY/etc.).
/// `safety_cap` bounds the maximum number of occurrences emitted.
pub fn expand(rule: &Rule, dtstart: i64, cutoff: i64, safety_cap: usize) -> Vec<i64> {
    let mut out: Vec<i64> = Vec::new();
    let count_limit = rule.count.map(|c| c as usize);

    let stop_ts = match rule.until {
        Some(u) => u.min(cutoff),
        None => cutoff,
    };

    match rule.freq {
        Freq::Daily => {
            let step = Duration::days(rule.interval as i64);
            let mut t = ts_to_dt(dtstart);
            while t.and_utc().timestamp() <= stop_ts {
                out.push(t.and_utc().timestamp());
                if let Some(c) = count_limit {
                    if out.len() >= c {
                        break;
                    }
                }
                if out.len() >= safety_cap {
                    break;
                }
                t += step;
            }
        }
        Freq::Weekly => {
            let by_day = rule.by_day.clone();
            let t0 = ts_to_dt(dtstart);

            let allowed: Vec<Weekday> = if by_day.is_empty() {
                vec![t0.weekday()]
            } else {
                by_day
            };

            // Walk by 1 day from dtstart; emit when weekday matches and the week
            // (relative to dtstart's week) aligns with INTERVAL.
            let start_week = iso_week_index(t0);
            let mut t = t0;
            loop {
                let ts = t.and_utc().timestamp();
                if ts > stop_ts {
                    break;
                }
                let weeks_since = (iso_week_index(t) - start_week).max(0);
                if weeks_since % rule.interval as i64 == 0
                    && allowed.contains(&t.weekday())
                    && ts >= dtstart
                {
                    out.push(ts);
                    if let Some(c) = count_limit {
                        if out.len() >= c {
                            break;
                        }
                    }
                    if out.len() >= safety_cap {
                        break;
                    }
                }
                t += Duration::days(1);
            }
        }
        Freq::Monthly => {
            let mut t = ts_to_dt(dtstart);
            loop {
                let ts = t.and_utc().timestamp();
                if ts > stop_ts {
                    break;
                }
                out.push(ts);
                if let Some(c) = count_limit {
                    if out.len() >= c {
                        break;
                    }
                }
                if out.len() >= safety_cap {
                    break;
                }
                t = add_months(t, rule.interval as i64);
            }
        }
    }

    out
}

fn ts_to_dt(ts: i64) -> NaiveDateTime {
    Utc.timestamp_opt(ts, 0).single().unwrap().naive_utc()
}

fn iso_week_index(t: NaiveDateTime) -> i64 {
    // Approximate: total days since epoch / 7. Stable for week-interval comparisons.
    t.and_utc().timestamp() / (7 * 86400)
}

fn add_months(t: NaiveDateTime, months: i64) -> NaiveDateTime {
    let mut year = t.year() as i64;
    let mut month0 = (t.month() as i64) - 1 + months;
    year += month0.div_euclid(12);
    month0 = month0.rem_euclid(12);
    let month = (month0 + 1) as u32;
    // Clamp day to month length.
    let day = t.day();
    let last_day = days_in_month(year as i32, month);
    let day = day.min(last_day);
    let date = chrono::NaiveDate::from_ymd_opt(year as i32, month, day).unwrap();
    date.and_hms_opt(t.hour(), t.minute(), t.second()).unwrap()
}

fn days_in_month(year: i32, month: u32) -> u32 {
    use chrono::NaiveDate;
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = NaiveDate::from_ymd_opt(ny, nm, 1).unwrap();
    let last_this = first_next.pred_opt().unwrap();
    last_this.day()
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

    #[test]
    fn expand_weekly_monday_for_three_weeks() {
        // Mon 2024-01-01 12:00 UTC = 1704110400
        let start = 1704110400;
        // cutoff: Mon 2024-01-22 12:00 UTC = 1705924800 (expect Jan 1, 8, 15, 22)
        let cutoff = 1705924800;
        let rule = parse_rule("FREQ=WEEKLY;BYDAY=MO").unwrap();
        let occs = expand(&rule, start, cutoff, 1000);
        assert_eq!(occs, vec![1704110400, 1704715200, 1705320000, 1705924800]);
    }

    #[test]
    fn expand_daily_count_limits() {
        let start = 1704067200; // 2024-01-01 00:00 UTC
        let cutoff = 9999999999;
        let rule = parse_rule("FREQ=DAILY;COUNT=3").unwrap();
        let occs = expand(&rule, start, cutoff, 1000);
        assert_eq!(occs.len(), 3);
        assert_eq!(occs[0], 1704067200);
        assert_eq!(occs[1], 1704153600);
        assert_eq!(occs[2], 1704240000);
    }

    #[test]
    fn expand_until_limits() {
        let start = 1704067200; // 2024-01-01
        let cutoff = 9999999999;
        // UNTIL=20240103T000000Z = 1704240000
        let rule = parse_rule("FREQ=DAILY;UNTIL=20240103T000000Z").unwrap();
        let occs = expand(&rule, start, cutoff, 1000);
        assert_eq!(occs.len(), 3);
    }

    #[test]
    fn expand_respects_safety_cap() {
        let start = 1704067200;
        let cutoff = 9999999999;
        let rule = parse_rule("FREQ=DAILY").unwrap();
        let occs = expand(&rule, start, cutoff, 5);
        assert_eq!(occs.len(), 5);
    }

    #[test]
    fn expand_monthly_steps_one_month() {
        let start = 1704067200; // 2024-01-01 00:00 UTC
        let cutoff = 9999999999;
        let rule = parse_rule("FREQ=MONTHLY;COUNT=3").unwrap();
        let occs = expand(&rule, start, cutoff, 100);
        assert_eq!(occs.len(), 3);
        // Feb 1, 2024 = 1706745600
        assert_eq!(occs[1], 1706745600);
        // Mar 1, 2024 = 1709251200
        assert_eq!(occs[2], 1709251200);
    }
}
