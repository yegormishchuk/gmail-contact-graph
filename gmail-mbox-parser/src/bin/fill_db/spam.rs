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

    // 4. One-way communication (traffic in only one direction)
    if is_one_way_contact(received, sent) {
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

/// One-way contacts: mail flowed in only one direction.
///
/// Deliberately strict — a correspondent worth putting on the graph is one you
/// both wrote to and heard from, so a missing direction is enough on its own.
/// There is no volume threshold: a single unanswered message is already
/// one-way.
fn is_one_way_contact(received: u32, sent: u32) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A contact with traffic in both directions, so the one-way rule (which
    /// fires on its own) never masks the rule actually under test.
    fn spam(email: &str, name: &str) -> bool {
        is_spam_contact(email, name, 5, 3)
    }

    #[test]
    fn a_two_way_human_contact_is_kept() {
        assert!(!spam("alice@example.com", "Alice Smith"));
    }

    // -----------------------------------------------------------------------
    // matches_patterns — token vs substring strategy
    // -----------------------------------------------------------------------

    #[test]
    fn a_simple_pattern_matches_only_a_whole_token() {
        // The reason the token strategy exists: "sale" must not hit "rosales".
        assert!(!matches_patterns("rosales", &["sale"]));
        assert!(matches_patterns("sale", &["sale"]));
        assert!(matches_patterns("weekly.sale", &["sale"]));
        assert!(matches_patterns("sale+promo", &["sale"]));
    }

    #[test]
    fn a_compound_pattern_matches_as_a_substring() {
        // Patterns carrying '-', '_' or '.' survive being glued to other text.
        assert!(matches_patterns("xxno-replyxx", &["no-reply"]));
    }

    #[test]
    fn rosales_is_not_treated_as_a_sales_address() {
        assert!(!spam("maria.rosales@example.com", "Maria Rosales"));
    }

    // -----------------------------------------------------------------------
    // is_spam_contact — one rule per branch
    // -----------------------------------------------------------------------

    #[test]
    fn noreply_addresses_are_spam() {
        assert!(spam("noreply@shop.com", "Shop"));
        assert!(spam("no-reply@shop.com", "Shop"));
        assert!(spam("do_not_reply@shop.com", "Shop"));
    }

    #[test]
    fn automated_senders_are_spam() {
        assert!(spam("mailer-daemon@host.com", "Mail Delivery"));
        assert!(spam("notifications@app.com", "App"));
    }

    #[test]
    fn marketing_addresses_are_spam() {
        assert!(spam("newsletter@blog.com", "Blog"));
        assert!(spam("promo@shop.com", "Shop"));
    }

    #[test]
    fn blocked_domains_are_spam() {
        assert!(spam("person@sendgrid.net", "Person"));
        assert!(spam("person@linkedin.com", "Person"));
    }

    #[test]
    fn subdomains_of_blocked_domains_are_spam() {
        assert!(spam("person@mail.sendgrid.net", "Person"));
    }

    #[test]
    fn a_domain_merely_ending_in_a_blocked_name_is_not_blocked() {
        // "notebay.com" ends with "ebay.com" as text but is a different domain,
        // so the check requires a dot before the suffix.
        assert!(!spam("person@notebay.com", "Person"));
    }

    #[test]
    fn the_address_is_matched_case_insensitively() {
        assert!(spam("NoReply@Shop.com", "Shop"));
    }

    // -----------------------------------------------------------------------
    // is_one_way_contact
    // -----------------------------------------------------------------------

    #[test]
    fn one_way_traffic_is_spam_in_either_direction() {
        assert!(is_one_way_contact(10, 0));
        assert!(is_one_way_contact(0, 10));
        assert!(!is_one_way_contact(1, 1));
    }

    #[test]
    fn a_single_unanswered_message_is_already_one_way() {
        // No volume threshold — documented behaviour, not an oversight.
        assert!(is_spam_contact("alice@example.com", "Alice", 1, 0));
    }

    // -----------------------------------------------------------------------
    // is_suspicious_name
    // -----------------------------------------------------------------------

    #[test]
    fn an_all_caps_name_is_suspicious() {
        assert!(is_suspicious_name("WINNER ANNOUNCEMENT"));
    }

    #[test]
    fn a_short_acronym_is_not_suspicious() {
        assert!(!is_suspicious_name("CEO"));
    }

    #[test]
    fn an_empty_name_is_not_suspicious() {
        assert!(!is_suspicious_name(""));
        assert!(!is_suspicious_name("   "));
    }

    #[test]
    fn a_name_drowning_in_punctuation_is_suspicious() {
        assert!(is_suspicious_name("*** WIN ***"));
    }

    #[test]
    fn an_ordinary_name_with_punctuation_is_kept() {
        assert!(!is_suspicious_name("Jean-Luc O'Brien"));
    }

    #[test]
    fn spam_wording_in_the_name_is_suspicious() {
        assert!(is_suspicious_name("Do Not Reply"));
        assert!(is_suspicious_name("System Notification"));
    }
}
