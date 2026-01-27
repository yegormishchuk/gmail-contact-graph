/// Extract name and email from a "From: " line.
pub fn parse_sender(line: &str) -> Option<(String, String)> {
    let sender = line.get(5..)?.trim();

    // Find email (word containing @)
    let email = sender
        .split_whitespace()
        .find(|word| word.contains('@'))?
        .trim_matches(|c| "<>\"',;()".contains(c))
        .to_lowercase();

    if email.is_empty() || !email.contains('@') {
        return None;
    }

    // Extract name (part before <email>)
    let name = if let Some(pos) = sender.find('<') {
        let name_part = sender[..pos].trim().trim_matches(|c| "\"'".contains(c));
        if name_part.is_empty() || name_part.to_lowercase() == email {
            email.split('@').next().unwrap_or(&email).to_string()
        } else {
            name_part.to_string()
        }
    } else {
        email.split('@').next().unwrap_or(&email).to_string()
    };

    Some((name, email))
}

/// Extract all email addresses from a header value (To/CC field content).
pub fn parse_all_emails(text: &str) -> Vec<String> {
    let mut emails = Vec::new();
    for part in text.split(',') {
        for word in part.split_whitespace() {
            if word.contains('@') {
                let email = word
                    .trim_matches(|c| "<>\"',;()".contains(c))
                    .to_lowercase();
                if !email.is_empty() && email.contains('@') {
                    emails.push(email);
                }
                break;
            }
        }
    }
    emails
}

/// Extract all (name, email) pairs from a header value (To/CC field content).
pub fn parse_all_recipients(text: &str) -> Vec<(String, String)> {
    let mut recipients = Vec::new();
    for part in text.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let fake_from = format!("From: {}", part);
        if let Some((name, email)) = parse_sender(&fake_from) {
            recipients.push((name, email));
        }
    }
    recipients
}
