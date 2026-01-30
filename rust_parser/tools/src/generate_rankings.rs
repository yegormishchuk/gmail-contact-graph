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
         FROM contacts"
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

    println!("Loading contacts from {}...", db_path);
    let contacts = load_contacts(db_path)?;
    println!("Loaded {} contacts", contacts.len());

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

    println!("All rankings generated in {}/", output_dir);
    Ok(())
}
