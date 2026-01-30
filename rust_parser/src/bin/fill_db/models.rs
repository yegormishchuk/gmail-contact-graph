/// Parsed email message structure
#[derive(Default)]
pub struct EmailMessage {
    pub from_email: String,
    pub from_name: String,
    pub to: Vec<(String, String)>, // Vec<(email, name)>
    pub delivered_to: String,      // Gmail uses this for the actual recipient
    pub subject: String,
    pub date: Option<i64>,
    pub content_type: String,
    pub transfer_encoding: String,
    pub charset: String,
    pub boundary: String,
    pub body: Vec<u8>,
}

/// Parser state machine
pub enum ParseState {
    Seeking,
    Headers,
    Body,
}

/// Accumulator for contact statistics
#[derive(Default)]
pub struct ContactStats {
    pub name: String,
    pub received: u32,
    pub sent: u32,
    pub first_timestamp: Option<i64>,
    pub last_timestamp: Option<i64>,
    pub total_chars: u64,
    pub email_count: u32,
}

impl ContactStats {
    pub fn update_timestamps(&mut self, timestamp: i64) {
        match self.first_timestamp {
            None => self.first_timestamp = Some(timestamp),
            Some(first) if timestamp < first => self.first_timestamp = Some(timestamp),
            _ => {}
        }
        match self.last_timestamp {
            None => self.last_timestamp = Some(timestamp),
            Some(last) if timestamp > last => self.last_timestamp = Some(timestamp),
            _ => {}
        }
    }
}
