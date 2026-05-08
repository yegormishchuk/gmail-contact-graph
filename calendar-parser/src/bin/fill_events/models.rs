use serde::{Deserialize, Serialize};

#[derive(Default, Debug)]
pub struct CalendarEvent {
    pub uid: String,
    pub summary: String,
    pub description: String,
    pub location: String,
    pub organizer_email: String,
    pub organizer_name: String,
    pub attendees: Vec<Attendee>,
    pub dtstart: Option<i64>,
    pub dtend: Option<i64>,
    pub created: Option<i64>,
    pub last_modified: Option<i64>,
    pub status: String,
    pub transp: String,
    pub sequence: i64,
    pub rrule: String,
    pub source_file: String,
}

#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct Attendee {
    pub email: String,
    pub name: String,
    pub role: String,
    pub partstat: String,
    pub cutype: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ParseState {
    Seeking,
    InEvent,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_event_default_is_empty() {
        let e = CalendarEvent::default();
        assert!(e.uid.is_empty());
        assert!(e.attendees.is_empty());
        assert_eq!(e.dtstart, None);
    }

    #[test]
    fn attendee_serializes_to_json() {
        let a = Attendee {
            email: "x@y.com".into(),
            name: "X".into(),
            role: "REQ-PARTICIPANT".into(),
            partstat: "ACCEPTED".into(),
            cutype: "INDIVIDUAL".into(),
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"email\":\"x@y.com\""));
        assert!(json.contains("\"role\":\"REQ-PARTICIPANT\""));
    }
}
