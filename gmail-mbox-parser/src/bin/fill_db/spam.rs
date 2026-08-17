/// Matches local_part against patterns using two strategies:
/// - Patterns containing `-`, `_`, or `.`: substring match (they're specific compound words)
/// - Simple word patterns: exact token match after splitting on `.`, `_`, `-`, `+`
///   This prevents false positives where a pattern like "sale" would match "rosales".
fn matches_patterns(local_part: &str, patterns: &[&str]) -> bool {
    let tokens: Vec<&str> = local_part.split(['.', '_', '-', '+']).collect();
    patterns.iter().any(|p| {
        if p.contains(['-', '_', '.']) {
            local_part.contains(p)
        } else {
            tokens.contains(p)
        }
    })
}

/// Check if a contact should be considered spam/automated
pub fn is_spam_contact(email: &str, name: &str, received: u32, sent: u32) -> bool {
    let email_lower = email.to_lowercase();
    let local_part = email_lower.split('@').next().unwrap_or("");
    let domain = email_lower.split('@').nth(1).unwrap_or("");

    // 1. No-reply addresses
    if is_noreply_address(local_part) {
        return true;
    }

    // 2. Automated senders
    if is_automated_sender(local_part) {
        return true;
    }

    // 3. Marketing/newsletter patterns
    if is_marketing_address(local_part) {
        return true;
    }

    // 4. One-way communication (received only, never sent to, high volume)
    if is_one_way_high_volume(received, sent) {
        return true;
    }

    // 5. Domain blocklist
    if is_blocked_domain(domain) {
        return true;
    }

    // 6. Suspicious name patterns
    if is_suspicious_name(name) {
        return true;
    }

    false
}

/// No-reply addresses
fn is_noreply_address(local_part: &str) -> bool {
    let noreply_patterns = [
        "noreply",
        "no-reply",
        "no_reply",
        "donotreply",
        "do-not-reply",
        "do_not_reply",
        "donot-reply",
    ];

    matches_patterns(local_part, &noreply_patterns)
}

/// Automated/system senders
fn is_automated_sender(local_part: &str) -> bool {
    let automated_patterns = [
        "mailer-daemon",
        "mailerdaemon",
        "postmaster",
        "automail",
        "auto-mail",
        "automated",
        "automatic",
        "daemon",
        "system",
        "admin",
        "root",
        "bounce",
        "notification",
        "notifications",
        "alert",
        "alerts",
    ];

    matches_patterns(local_part, &automated_patterns)
}

/// Marketing/newsletter addresses
fn is_marketing_address(local_part: &str) -> bool {
    let marketing_patterns = [
        "newsletter",
        "news-letter",
        "marketing",
        "promo",
        "promotion",
        "promotions",
        "campaign",
        "campaigns",
        "offer",
        "offers",
        "deals",
        "sale",
        "sales",
        "subscribe",
        "subscription",
        "unsubscribe",
        "info",
        "support",
        "contact",
        "hello",
        "team",
        "updates",
        "digest",
        "weekly",
        "daily",
        "monthly",
        "announce",
        "announcement",
        "broadcast",
    ];

    matches_patterns(local_part, &marketing_patterns)
}

/// One-way high volume senders (received many, sent zero)
fn is_one_way_high_volume(received: u32, sent: u32) -> bool {
    // Only received emails, never sent any, and high volume
    received == 0 || sent == 0
}

/// Known spam/automated domains
fn is_blocked_domain(domain: &str) -> bool {
    let blocked_domains = [
        // Transactional/notification services
        "sendgrid.net",
        "sendgrid.com",
        "mailchimp.com",
        "mailgun.org",
        "mailgun.com",
        "amazonses.com",
        "mandrillapp.com",
        "postmarkapp.com",
        "sparkpostmail.com",
        "constantcontact.com",
        "hubspot.com",
        "hubspotmail.com",
        "intercom.io",
        "intercom-mail.com",
        // Social media notifications
        "facebookmail.com",
        "twittermail.com",
        "linkedin.com",
        "linkedinmail.com",
        "pinterest.com",
        "instagram.com",
        // E-commerce
        "shopify.com",
        "ebay.com",
        "paypal.com",
        // Newsletters
        "substack.com",
        "beehiiv.com",
        "convertkit.com",
        "buttondown.email",
        "getrevue.co",
    ];

    blocked_domains
        .iter()
        .any(|d| domain == *d || domain.ends_with(&format!(".{}", d)))
}

/// Suspicious name patterns (all caps, excessive punctuation, empty)
fn is_suspicious_name(name: &str) -> bool {
    let trimmed = name.trim();

    // Empty or very short names that look automated
    if trimmed.is_empty() {
        return false; // Empty name is OK, might just be missing
    }

    // All uppercase (more than 3 chars to avoid initials like "CEO")
    if trimmed.len() > 3
        && trimmed == trimmed.to_uppercase()
        && trimmed.chars().any(|c| c.is_alphabetic())
    {
        return true;
    }

    // Excessive punctuation or special characters
    let special_count = trimmed
        .chars()
        .filter(|c| !c.is_alphanumeric() && !c.is_whitespace())
        .count();
    let alpha_count = trimmed.chars().filter(|c| c.is_alphabetic()).count();

    if alpha_count > 0 && special_count as f64 / alpha_count as f64 > 0.5 {
        return true;
    }

    // Contains typical spam indicators
    let spam_name_patterns = [
        "noreply",
        "no-reply",
        "do not reply",
        "automated",
        "system notification",
    ];

    let name_lower = trimmed.to_lowercase();
    if spam_name_patterns.iter().any(|p| name_lower.contains(p)) {
        return true;
    }

    false
}
