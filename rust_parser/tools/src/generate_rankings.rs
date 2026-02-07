use rusqlite::{Connection, Result};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::Path;

#[derive(Debug, Clone)]
struct Contact {
    name: String,
    email: String,
    sent: i64,
    received: i64,
    duration: f64,
    average_chars: f64,
}

impl Contact {
    fn sent_per_month(&self) -> f64 {
        if self.duration <= 0.0 {
            self.sent as f64
        } else {
            let months = self.duration / 30.44;
            if months < 1.0 {
                self.sent as f64
            } else {
                self.sent as f64 / months
            }
        }
    }

    fn received_per_month(&self) -> f64 {
        if self.duration <= 0.0 {
            self.received as f64
        } else {
            let months = self.duration / 30.44;
            if months < 1.0 {
                self.received as f64
            } else {
                self.received as f64 / months
            }
        }
    }
}

fn load_contacts(db_path: &str) -> Result<Vec<Contact>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT name, email, sent, received,
                COALESCE(duration, 0) as duration,
                COALESCE(average_chars, 0) as average_chars
         FROM contacts_filtered"
    )?;

    let contacts = stmt.query_map([], |row| {
        Ok(Contact {
            name: row.get(0)?,
            email: row.get(1)?,
            sent: row.get(2)?,
            received: row.get(3)?,
            duration: row.get(4)?,
            average_chars: row.get(5)?,
        })
    })?
    .filter_map(|r| r.ok())
    .collect();

    Ok(contacts)
}

/// Assigns ranks with equal places for equal values
/// Returns vector of (rank, original_index) pairs sorted by rank
fn assign_ranks<F>(contacts: &[Contact], value_fn: F, descending: bool) -> Vec<(usize, usize)>
where
    F: Fn(&Contact) -> f64,
{
    let mut indexed: Vec<(usize, f64)> = contacts
        .iter()
        .enumerate()
        .map(|(i, c)| (i, value_fn(c)))
        .collect();

    // Sort by value
    if descending {
        indexed.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    } else {
        indexed.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    }

    let mut result = Vec::with_capacity(indexed.len());
    let mut current_rank = 1;
    let mut prev_value: Option<f64> = None;
    let mut same_value_count = 0;

    for (idx, value) in indexed {
        if let Some(prev) = prev_value {
            if (value - prev).abs() < 1e-9 {
                // Same value, same rank
                same_value_count += 1;
            } else {
                // Different value, advance rank by count of previous same-ranked items
                current_rank += same_value_count;
                same_value_count = 1;
            }
        } else {
            same_value_count = 1;
        }

        result.push((current_rank, idx));
        prev_value = Some(value);
    }

    result
}

fn write_ranking<F>(
    contacts: &[Contact],
    output_path: &str,
    value_fn: F,
    format_value: fn(f64) -> String,
    descending: bool,
) -> std::io::Result<()>
where
    F: Fn(&Contact) -> f64,
{
    let ranks = assign_ranks(contacts, &value_fn, descending);

    let file = File::create(output_path)?;
    let mut writer = BufWriter::new(file);

    for (rank, idx) in ranks {
        let contact = &contacts[idx];
        let value = value_fn(contact);
        let formatted_value = format_value(value);
        writeln!(
            writer,
            "{}. {} {} {}",
            rank, contact.name, contact.email, formatted_value
        )?;
    }

    Ok(())
}

fn format_int(v: f64) -> String {
    format!("{}", v as i64)
}

fn format_float(v: f64) -> String {
    format!("{:.2}", v)
}

// ============================================================================
// Composite Ranking System
// ============================================================================

/// Configuration for a ranking that participates in the composite score
struct RankingConfig {
    name: &'static str,
    coefficient: f64,
    value_fn: fn(&Contact) -> f64,
}

/// Stores contact's position in each ranking
struct ContactRankings {
    email: String,
    name: String,
    /// (ranking_name, rank, points) for each participating ranking
    rankings: Vec<(&'static str, usize, f64)>,
    total_score: f64,
}

/// Calculates points based on rank: 1st place = n points, 2nd = n-1, etc.
fn rank_to_points(rank: usize, total_contacts: usize) -> f64 {
    if rank > total_contacts {
        0.0
    } else {
        (total_contacts - rank + 1) as f64
    }
}

/// Generates composite ranking from multiple rankings with coefficients
fn generate_composite_ranking(
    contacts: &[Contact],
    ranking_configs: &[RankingConfig],
) -> Vec<ContactRankings> {
    use std::collections::HashMap;

    let total_contacts = contacts.len();

    // Map email -> ContactRankings
    let mut contact_scores: HashMap<String, ContactRankings> = HashMap::new();

    // Initialize all contacts
    for contact in contacts {
        contact_scores.insert(
            contact.email.clone(),
            ContactRankings {
                email: contact.email.clone(),
                name: contact.name.clone(),
                rankings: Vec::new(),
                total_score: 0.0,
            },
        );
    }

    // Process each ranking
    for config in ranking_configs {
        let ranks = assign_ranks(contacts, config.value_fn, true);

        for (rank, idx) in ranks {
            let contact = &contacts[idx];
            let points = rank_to_points(rank, total_contacts);
            let weighted_points = points * config.coefficient;

            if let Some(cr) = contact_scores.get_mut(&contact.email) {
                cr.rankings.push((config.name, rank, weighted_points));
                cr.total_score += weighted_points;
            }
        }
    }

    // Convert to vector and sort by total score (descending)
    let mut result: Vec<ContactRankings> = contact_scores.into_values().collect();
    result.sort_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap());

    result
}

/// Writes composite ranking to file in a readable format
fn write_composite_ranking(
    composite: &[ContactRankings],
    ranking_configs: &[RankingConfig],
    output_path: &str,
) -> std::io::Result<()> {
    let file = File::create(output_path)?;
    let mut writer = BufWriter::new(file);

    // Header with ranking info
    writeln!(writer, "# Composite Contact Ranking")?;
    writeln!(writer, "# Rankings used:")?;
    for config in ranking_configs {
        writeln!(writer, "#   - {} (coefficient: {})", config.name, config.coefficient)?;
    }
    writeln!(writer, "#")?;
    writeln!(writer, "# Score formula: sum of (n - rank + 1) * coefficient for each ranking")?;
    writeln!(writer, "# where n = total number of contacts ({})", composite.len())?;
    writeln!(writer, "#")?;
    writeln!(writer)?;

    // Assign final ranks with ties
    let mut final_rank = 1;
    let mut prev_score: Option<f64> = None;
    let mut same_score_count = 0;

    for cr in composite {
        if let Some(prev) = prev_score {
            if (cr.total_score - prev).abs() < 1e-9 {
                same_score_count += 1;
            } else {
                final_rank += same_score_count;
                same_score_count = 1;
            }
        } else {
            same_score_count = 1;
        }

        // Build ranking details string
        let ranking_details: Vec<String> = cr
            .rankings
            .iter()
            .map(|(name, rank, points)| format!("{}:#{} ({:.1})", name, rank, points))
            .collect();

        writeln!(
            writer,
            "{}. {} {} | score: {:.1} | {}",
            final_rank,
            cr.name,
            cr.email,
            cr.total_score,
            ranking_details.join(", ")
        )?;

        prev_score = Some(cr.total_score);
    }

    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    let db_path = if args.len() > 1 {
        &args[1]
    } else {
        "contacts.db"
    };

    let output_dir = if args.len() > 2 {
        &args[2]
    } else {
        "data"
    };

    // Create output directory if it doesn't exist
    if !Path::new(output_dir).exists() {
        fs::create_dir_all(output_dir)?;
    }

    println!("Loading filtered contacts from {}...", db_path);
    let contacts = load_contacts(db_path)?;
    println!("Loaded {} filtered contacts", contacts.len());

    // Generate rankings for each criterion
    // All rankings are descending (highest value = rank 1)

    // 1. Sent emails ranking
    println!("Generating sent_ranking...");
    write_ranking(
        &contacts,
        &format!("{}/sent_ranking.txt", output_dir),
        |c| c.sent as f64,
        format_int,
        true,
    )?;

    // 2. Sent per month ranking
    println!("Generating sent_per_month_ranking...");
    write_ranking(
        &contacts,
        &format!("{}/sent_per_month_ranking.txt", output_dir),
        |c| c.sent_per_month(),
        format_float,
        true,
    )?;

    // 3. Received emails ranking
    println!("Generating received_ranking...");
    write_ranking(
        &contacts,
        &format!("{}/received_ranking.txt", output_dir),
        |c| c.received as f64,
        format_int,
        true,
    )?;

    // 4. Received per month ranking
    println!("Generating received_per_month_ranking...");
    write_ranking(
        &contacts,
        &format!("{}/received_per_month_ranking.txt", output_dir),
        |c| c.received_per_month(),
        format_float,
        true,
    )?;

    // 5. Duration ranking (communication duration in days)
    println!("Generating duration_ranking...");
    write_ranking(
        &contacts,
        &format!("{}/duration_ranking.txt", output_dir),
        |c| c.duration,
        format_float,
        true,
    )?;

    // 6. Email length ranking (average characters)
    println!("Generating email_length_ranking...");
    write_ranking(
        &contacts,
        &format!("{}/email_length_ranking.txt", output_dir),
        |c| c.average_chars,
        format_float,
        true,
    )?;

    // ========================================================================
    // Composite Ranking
    // ========================================================================
    // Configure which rankings to use and their coefficients
    // Easy to modify: just add/remove configs or change coefficients
    let ranking_configs = vec![
        RankingConfig {
            name: "sent",
            coefficient: 1.0,
            value_fn: |c| c.sent as f64,
        },
        RankingConfig {
            name: "received",
            coefficient: 0.2,
            value_fn: |c| c.received as f64,
        },
    ];

    println!("Generating composite_ranking...");
    let composite = generate_composite_ranking(&contacts, &ranking_configs);
    write_composite_ranking(
        &composite,
        &ranking_configs,
        &format!("{}/composite_ranking.txt", output_dir),
    )?;

    println!("All rankings generated in {}/", output_dir);
    Ok(())
}
