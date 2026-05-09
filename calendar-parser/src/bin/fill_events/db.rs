use std::collections::HashMap;

use rusqlite::{params, Connection, Statement};

use crate::models::{Attendee, CalendarEvent};
use crate::recurrence::{expand, parse_rule};

pub fn setup_events_db(conn: &Connection) {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA cache_size = -64000;
         PRAGMA temp_store = MEMORY;",
    )
    .unwrap();

    conn.execute_batch(
        "DROP TABLE IF EXISTS events;
         CREATE TABLE events (
             id              INTEGER PRIMARY KEY AUTOINCREMENT,
             uid             TEXT NOT NULL,
             occurrence_idx  INTEGER NOT NULL DEFAULT 0,
             summary         TEXT NOT NULL DEFAULT '',
             description     TEXT NOT NULL DEFAULT '',
             location        TEXT NOT NULL DEFAULT '',
             organizer_email TEXT NOT NULL DEFAULT '',
             organizer_name  TEXT NOT NULL DEFAULT '',
             attendees_json  TEXT NOT NULL DEFAULT '[]',
             dtstart         INTEGER,
             dtend           INTEGER,
             created         INTEGER,
             last_modified   INTEGER,
             status          TEXT NOT NULL DEFAULT '',
             transp          TEXT NOT NULL DEFAULT '',
             sequence        INTEGER NOT NULL DEFAULT 0,
             rrule           TEXT NOT NULL DEFAULT '',
             is_recurring    INTEGER NOT NULL DEFAULT 0,
             source_file     TEXT NOT NULL DEFAULT ''
         );
         CREATE INDEX IF NOT EXISTS idx_events_uid ON events(uid);
         CREATE INDEX IF NOT EXISTS idx_events_dtstart ON events(dtstart);
         CREATE INDEX IF NOT EXISTS idx_events_organizer ON events(organizer_email);",
    )
    .unwrap();
}

pub fn setup_event_attendees_table(conn: &Connection) {
    conn.execute_batch(
        "DROP TABLE IF EXISTS event_attendees;
         CREATE TABLE event_attendees (
             email                  TEXT PRIMARY KEY,
             name                   TEXT NOT NULL DEFAULT '',
             organized_events_count INTEGER NOT NULL DEFAULT 0,
             invited_events_count   INTEGER NOT NULL DEFAULT 0,
             total_events_count     INTEGER NOT NULL DEFAULT 0,
             event_ids_json         TEXT NOT NULL DEFAULT '[]',
             avg_duration_seconds   REAL,
             avg_attendee_count     REAL,
             acceptance_rate        REAL,
             accepted_count         INTEGER NOT NULL DEFAULT 0,
             declined_count         INTEGER NOT NULL DEFAULT 0
         );",
    )
    .unwrap();
}

#[derive(Default)]
struct AttendeeStats {
    name: String,
    organized: u64,
    invited: u64,
    event_ids: Vec<i64>,
    duration_sum: i64,
    duration_n: u64,
    attendee_count_sum: u64,
    attendee_count_n: u64,
    accepted: u64,
    declined: u64,
}

/// Aggregate per-attendee stats from the events table and write them to event_attendees.
/// Excludes the webapp user's own row. Each event row (master + every recurring occurrence)
/// counts independently.
pub fn populate_event_attendees(conn: &Connection, user_email: &str) -> u64 {
    let user_lc = user_email.trim().to_lowercase();
    let mut map: HashMap<String, AttendeeStats> = HashMap::new();

    {
        let mut stmt = conn
            .prepare("SELECT id, organizer_email, attendees_json, dtstart, dtend FROM events")
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .unwrap();

        for r in rows {
            let (event_id, organizer_email, attendees_json, dtstart, dtend) = r.unwrap();
            let organizer_lc = organizer_email.trim().to_lowercase();
            let attendees: Vec<Attendee> =
                serde_json::from_str(&attendees_json).unwrap_or_default();
            let attendee_n = attendees.len() as u64;
            let duration = match (dtstart, dtend) {
                (Some(s), Some(e)) => Some(e - s),
                _ => None,
            };

            // Webapp user's partstat in this event (used when a non-self attendee is the organizer).
            let user_partstat: Option<String> = attendees
                .iter()
                .find(|a| a.email.trim().to_lowercase() == user_lc)
                .map(|a| a.partstat.clone());

            for a in &attendees {
                let email_lc = a.email.trim().to_lowercase();
                if email_lc.is_empty() || email_lc == user_lc {
                    continue;
                }

                let s = map.entry(email_lc.clone()).or_default();
                if s.name.is_empty() && !a.name.is_empty() {
                    s.name = a.name.clone();
                }

                let is_organizer = !organizer_lc.is_empty() && email_lc == organizer_lc;
                if is_organizer {
                    s.organized += 1;
                } else {
                    s.invited += 1;
                }

                s.event_ids.push(event_id);

                if let Some(d) = duration {
                    s.duration_sum += d;
                    s.duration_n += 1;
                }
                s.attendee_count_sum += attendee_n;
                s.attendee_count_n += 1;

                // Acceptance: this attendee's own partstat unless they are the organizer,
                // in which case use the webapp user's partstat.
                let partstat: Option<&str> = if is_organizer {
                    user_partstat.as_deref()
                } else {
                    Some(a.partstat.as_str())
                };
                if let Some(ps) = partstat {
                    let ps_up = ps.trim().to_ascii_uppercase();
                    if ps_up == "ACCEPTED" {
                        s.accepted += 1;
                    } else if ps_up == "DECLINED" {
                        s.declined += 1;
                    }
                }
            }
        }
    }

    let mut count: u64 = 0;
    let mut ins = conn
        .prepare(
            "INSERT INTO event_attendees ( \
                email, name, organized_events_count, invited_events_count, total_events_count, \
                event_ids_json, avg_duration_seconds, avg_attendee_count, acceptance_rate, \
                accepted_count, declined_count \
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        )
        .unwrap();

    for (email, s) in &map {
        let total = s.organized + s.invited;
        let avg_dur: Option<f64> = if s.duration_n > 0 {
            Some(s.duration_sum as f64 / s.duration_n as f64)
        } else {
            None
        };
        let avg_att: Option<f64> = if s.attendee_count_n > 0 {
            Some(s.attendee_count_sum as f64 / s.attendee_count_n as f64)
        } else {
            None
        };
        let acc_denom = s.accepted + s.declined;
        let acc_rate: Option<f64> = if acc_denom > 0 {
            Some(s.accepted as f64 / acc_denom as f64)
        } else {
            None
        };
        let ids_json = serde_json::to_string(&s.event_ids).unwrap_or_else(|_| "[]".to_string());

        ins.execute(params![
            email,
            s.name,
            s.organized as i64,
            s.invited as i64,
            total as i64,
            ids_json,
            avg_dur,
            avg_att,
            acc_rate,
            s.accepted as i64,
            s.declined as i64,
        ])
        .unwrap();
        count += 1;
    }
    count
}

pub struct InsertCounts {
    pub masters: u64,
    pub occurrences: u64,
    pub skipped_unsupported: u64,
}

pub fn insert_event(
    stmt: &mut Statement,
    event: &CalendarEvent,
    today_cutoff: i64,
    safety_cap: usize,
) -> InsertCounts {
    let mut counts = InsertCounts { masters: 0, occurrences: 0, skipped_unsupported: 0 };

    let attendees_json = serde_json::to_string(&event.attendees).unwrap_or_else(|_| "[]".to_string());
    let is_recurring = !event.rrule.is_empty();

    // Master row
    if stmt
        .execute(params![
            event.uid,
            0i64,
            event.summary,
            event.description,
            event.location,
            event.organizer_email,
            event.organizer_name,
            attendees_json,
            event.dtstart,
            event.dtend,
            event.created,
            event.last_modified,
            event.status,
            event.transp,
            event.sequence,
            event.rrule,
            if is_recurring { 1i64 } else { 0i64 },
            event.source_file,
        ])
        .is_ok()
    {
        counts.masters += 1;
    }

    if !is_recurring {
        return counts;
    }

    let Some(dtstart) = event.dtstart else { return counts; };
    let duration = event.dtend.unwrap_or(dtstart) - dtstart;

    let rule = match parse_rule(&event.rrule) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[warn] unsupported RRULE for uid={}: {:?}", event.uid, e);
            counts.skipped_unsupported += 1;
            return counts;
        }
    };

    let occs = expand(&rule, dtstart, today_cutoff, safety_cap);
    if occs.len() == safety_cap {
        eprintln!("[warn] RRULE for uid={} hit safety cap of {}", event.uid, safety_cap);
    }

    for (idx, occ_start) in occs.iter().enumerate() {
        let occ_end = occ_start + duration;
        if stmt
            .execute(params![
                event.uid,
                (idx as i64) + 1,
                event.summary,
                event.description,
                event.location,
                event.organizer_email,
                event.organizer_name,
                attendees_json,
                *occ_start,
                occ_end,
                event.created,
                event.last_modified,
                event.status,
                event.transp,
                event.sequence,
                event.rrule,
                1i64,
                event.source_file,
            ])
            .is_ok()
        {
            counts.occurrences += 1;
        }
    }

    counts
}

pub const INSERT_SQL: &str = "INSERT INTO events ( \
    uid, occurrence_idx, summary, description, location, organizer_email, organizer_name, \
    attendees_json, dtstart, dtend, created, last_modified, status, transp, sequence, rrule, \
    is_recurring, source_file \
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Attendee, CalendarEvent};

    fn open_in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        setup_events_db(&conn);
        conn
    }

    #[test]
    fn insert_non_recurring_writes_one_row() {
        let conn = open_in_memory();
        let mut stmt = conn.prepare(INSERT_SQL).unwrap();

        let mut e = CalendarEvent::default();
        e.uid = "abc".into();
        e.summary = "Hi".into();
        e.dtstart = Some(1000);
        e.dtend = Some(2000);
        e.attendees.push(Attendee {
            email: "x@y.com".into(),
            name: "X".into(),
            ..Default::default()
        });

        let counts = insert_event(&mut stmt, &e, 9999999999, 1000);
        assert_eq!(counts.masters, 1);
        assert_eq!(counts.occurrences, 0);

        drop(stmt);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE uid='abc'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);

        let json: String = conn
            .query_row("SELECT attendees_json FROM events WHERE uid='abc'", [], |r| r.get(0))
            .unwrap();
        assert!(json.contains("x@y.com"));
    }

    #[test]
    fn insert_recurring_writes_master_plus_occurrences() {
        let conn = open_in_memory();
        let mut stmt = conn.prepare(INSERT_SQL).unwrap();

        let mut e = CalendarEvent::default();
        e.uid = "rec".into();
        e.summary = "weekly".into();
        e.dtstart = Some(1704110400); // Mon 2024-01-01 12:00 UTC
        e.dtend = Some(1704114000);   // +1h
        e.rrule = "FREQ=WEEKLY;BYDAY=MO;COUNT=3".into();

        let counts = insert_event(&mut stmt, &e, 9999999999, 1000);
        assert_eq!(counts.masters, 1);
        assert_eq!(counts.occurrences, 3);

        drop(stmt);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE uid='rec'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 4); // 1 master + 3 occurrences

        let master_idx: i64 = conn
            .query_row(
                "SELECT occurrence_idx FROM events WHERE uid='rec' AND is_recurring=1 ORDER BY occurrence_idx LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(master_idx, 0);
    }

    #[test]
    fn populate_event_attendees_aggregates_correctly() {
        let conn = Connection::open_in_memory().unwrap();
        setup_events_db(&conn);
        setup_event_attendees_table(&conn);

        let mut stmt = conn.prepare(INSERT_SQL).unwrap();

        // Event 1: webapp user organizes; alice accepts, bob declines.
        let mut e1 = CalendarEvent::default();
        e1.uid = "e1".into();
        e1.organizer_email = "me@x.com".into();
        e1.dtstart = Some(1000);
        e1.dtend = Some(4600); // 3600s
        e1.attendees = vec![
            Attendee { email: "me@x.com".into(), partstat: "ACCEPTED".into(), ..Default::default() },
            Attendee { email: "alice@x.com".into(), partstat: "ACCEPTED".into(), ..Default::default() },
            Attendee { email: "bob@x.com".into(), partstat: "DECLINED".into(), ..Default::default() },
        ];
        insert_event(&mut stmt, &e1, 9_999_999_999, 1000);

        // Event 2: alice organizes; webapp user declined.
        let mut e2 = CalendarEvent::default();
        e2.uid = "e2".into();
        e2.organizer_email = "alice@x.com".into();
        e2.dtstart = Some(2000);
        e2.dtend = Some(3800); // 1800s
        e2.attendees = vec![
            Attendee { email: "alice@x.com".into(), partstat: "ACCEPTED".into(), ..Default::default() },
            Attendee { email: "me@x.com".into(), partstat: "DECLINED".into(), ..Default::default() },
        ];
        insert_event(&mut stmt, &e2, 9_999_999_999, 1000);

        drop(stmt);

        let n = populate_event_attendees(&conn, "me@x.com");
        assert_eq!(n, 2); // alice + bob, no self row

        // No row for the webapp user.
        let self_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM event_attendees WHERE email='me@x.com'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(self_n, 0);

        // Alice: organizer of e2 (uses webapp user's DECLINED), attendee in e1 (ACCEPTED).
        let (alice_org, alice_inv, alice_acc, alice_dec, alice_rate, alice_avg_dur, alice_avg_att): (
            i64, i64, i64, i64, Option<f64>, Option<f64>, Option<f64>,
        ) = conn
            .query_row(
                "SELECT organized_events_count, invited_events_count, accepted_count, \
                 declined_count, acceptance_rate, avg_duration_seconds, avg_attendee_count \
                 FROM event_attendees WHERE email='alice@x.com'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .unwrap();
        assert_eq!(alice_org, 1);
        assert_eq!(alice_inv, 1);
        assert_eq!(alice_acc, 1); // ACCEPTED in e1
        assert_eq!(alice_dec, 1); // webapp user DECLINED in e2 (alice was organizer)
        assert_eq!(alice_rate, Some(0.5));
        assert_eq!(alice_avg_dur, Some((3600.0 + 1800.0) / 2.0));
        assert_eq!(alice_avg_att, Some((3.0 + 2.0) / 2.0));

        // Bob: only e1, declined.
        let (bob_org, bob_inv, bob_acc, bob_dec, bob_rate): (i64, i64, i64, i64, Option<f64>) = conn
            .query_row(
                "SELECT organized_events_count, invited_events_count, accepted_count, \
                 declined_count, acceptance_rate FROM event_attendees WHERE email='bob@x.com'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(bob_org, 0);
        assert_eq!(bob_inv, 1);
        assert_eq!(bob_acc, 0);
        assert_eq!(bob_dec, 1);
        assert_eq!(bob_rate, Some(0.0));
    }

    #[test]
    fn insert_unsupported_rrule_writes_master_only() {
        let conn = open_in_memory();
        let mut stmt = conn.prepare(INSERT_SQL).unwrap();

        let mut e = CalendarEvent::default();
        e.uid = "yearly".into();
        e.dtstart = Some(1000);
        e.rrule = "FREQ=YEARLY".into();

        let counts = insert_event(&mut stmt, &e, 9999999999, 1000);
        assert_eq!(counts.masters, 1);
        assert_eq!(counts.occurrences, 0);
        assert_eq!(counts.skipped_unsupported, 1);
    }
}
