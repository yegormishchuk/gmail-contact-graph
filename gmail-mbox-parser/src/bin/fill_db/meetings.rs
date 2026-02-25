/// Meeting detection patterns for Google Meet, Calendar, and scheduling services

/// List of scheduling service domain patterns
const SCHEDULING_SERVICES: &[&str] = &[
    // Google services
    "meet.google.com",
    "calendar.google.com",
    // Popular scheduling tools
    "calendly.com",
    "cal.com",
    "doodle.com",
    "youcanbook.me",
    "ycbm.com",
    "acuityscheduling.com",
    "chilipiper.com",
    "hubspot.com/meetings",
    "meetings.hubspot.com",
    "savvycal.com",
    "tidycal.com",
    "zencal.io",
    "reclaim.ai",
    "sprintful.com",
    "10to8.com",
    "zeeg.me",
    "sumoscheduler.com",
    "brevo.com/meetings",
    "zoho.com/bookings",
    "bookings.zoho.com",
    "appointlet.com",
    "setmore.com",
    "simplybook.me",
    "square.site/book",
    "squareup.com/appointments",
    "vcita.com",
    "oncehub.com",
    "scheduleonce.com",
    "harmonizely.com",
    "picktime.com",
    "supersaas.com",
    "vyte.in",
    "appointy.com",
    "booksy.com",
    "gettyimages.com/schedule",
    "koalendar.com",
    "meetingbird.com",
    "rallly.co",
    "when2meet.com",
    "lettucemeet.com",
    // Video conferencing with scheduling
    "zoom.us/j/",
    "zoom.us/my/",
    "teams.microsoft.com/l/meetup-join",
    "webex.com/meet",
];

/// Content patterns that indicate calendar/meeting invitations
const CALENDAR_CONTENT_PATTERNS: &[&str] = &[
    // ICS/calendar file indicators
    "text/calendar",
    "application/ics",
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    // Google Calendar specific
    "calendar-notification@google.com",
    "Invitation from Google Calendar",
    "You have been invited to the following event",
    "Accept this invitation",
    "Google Calendar: ",
    // Meeting invitation phrases
    "has invited you to a meeting",
    "join the meeting",
    "meeting invitation",
    "calendar invitation",
    "event invitation",
    "scheduled a meeting",
    "meeting scheduled",
    "booking confirmed",
    "appointment confirmed",
    "Your meeting with",
    "Meeting with ",
];

/// Check if an email contains meeting-related content
/// Returns true if the email subject or content contains meeting/scheduling indicators
pub fn contains_meeting_content(subject: &str, content: &str) -> bool {
    let subject_lower = subject.to_lowercase();
    let content_lower = content.to_lowercase();

    // Check for scheduling service URLs
    for service in SCHEDULING_SERVICES {
        if content_lower.contains(service) || subject_lower.contains(service) {
            return true;
        }
    }

    // Check for calendar content patterns
    for pattern in CALENDAR_CONTENT_PATTERNS {
        let pattern_lower = pattern.to_lowercase();
        if content_lower.contains(&pattern_lower) || subject_lower.contains(&pattern_lower) {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_google_meet_detection() {
        assert!(contains_meeting_content("", "Join at https://meet.google.com/abc-defg-hij"));
        assert!(contains_meeting_content("Meet link: meet.google.com/xyz", ""));
    }

    #[test]
    fn test_calendly_detection() {
        assert!(contains_meeting_content("", "Book a time: https://calendly.com/username"));
        assert!(contains_meeting_content("", "Your booking with John is confirmed at calendly.com/john"));
    }

    #[test]
    fn test_google_calendar_detection() {
        assert!(contains_meeting_content("Invitation from Google Calendar", ""));
        assert!(contains_meeting_content("", "You have been invited to the following event"));
        assert!(contains_meeting_content("", "BEGIN:VCALENDAR\nBEGIN:VEVENT"));
    }

    #[test]
    fn test_zoom_detection() {
        assert!(contains_meeting_content("", "https://zoom.us/j/123456789"));
        assert!(contains_meeting_content("", "Join: zoom.us/my/username"));
    }

    #[test]
    fn test_no_meeting() {
        assert!(!contains_meeting_content("Hello there", "Just a regular email about work"));
        assert!(!contains_meeting_content("Re: Project update", "Here's the latest status."));
    }
}
