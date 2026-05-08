use rusqlite::{params, Connection, Statement};

use crate::models::CalendarEvent;
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
