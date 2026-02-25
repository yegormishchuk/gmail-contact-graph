mod config;
mod contacts;

use std::env;
use std::fs::File;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};

use config::{HFConfig, HFConfigSummary, VerificationOutput, VerificationStats};
use contacts::load_filtered_contacts;
use fast_mbox_parser::hf::HFClient;

/// Default max concurrent requests (reduced to respect rate limits)
const DEFAULT_MAX_CONCURRENT: usize = 4;

#[tokio::main]
async fn main() {
    // Load .env file if present
    let _ = dotenvy::dotenv();
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    let contacts_db_path = &args[1];
    let output_path = args.get(2).map(|s| s.as_str()).unwrap_or("data/verification_results.json");

    // Build config from environment variables
    let config = match HFConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error: {}", e);
            eprintln!();
            print_usage();
            std::process::exit(1);
        }
    };

    // Get max concurrent requests from env or use default
    let max_concurrent: usize = env::var("HF_MAX_CONCURRENT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_MAX_CONCURRENT);

    eprintln!("=== Contact Verification with Hugging Face ===");
    eprintln!("Database: {}", contacts_db_path);
    eprintln!("Output: {}", output_path);
    eprintln!("Model: {}", config.model);
    eprintln!("Batch size: {}", config.batch_size);
    eprintln!("Max concurrent requests: {}", max_concurrent);
    eprintln!("Votes per batch: 4 (unanimous for 0/1)");
    eprintln!();

    // Load contacts that passed initial spam filter
    eprintln!("Loading contacts from database...");
    let contacts = match load_filtered_contacts(contacts_db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error loading contacts: {}", e);
            std::process::exit(1);
        }
    };

    eprintln!("Loaded {} contacts for verification", contacts.len());

    if contacts.is_empty() {
        eprintln!("No contacts to verify. Exiting.");
        std::process::exit(0);
    }

    // Create HF client
    let client = match HFClient::with_concurrency(config.clone(), max_concurrent) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error creating HF client: {}", e);
            std::process::exit(1);
        }
    };

    // Process contacts in batches
    let batch_size = config.batch_size;
    let total_batches = (contacts.len() + batch_size - 1) / batch_size;

    eprintln!("\nClassifying contacts ({} batches, {} contacts each, 4 votes per batch)...",
        total_batches, batch_size);

    // Progress counter for async callback
    let completed_batches = AtomicUsize::new(0);

    let results = client
        .classify_all_with_progress(&contacts, batch_size, |batch, total, count| {
            let completed = completed_batches.fetch_add(1, Ordering::SeqCst);
            eprintln!(
                "[Batch {}/{} ({} contacts)] Starting... ({} batches completed)",
                batch, total, count, completed
            );
        })
        .await;

    eprintln!();

    // Collect results and statistics
    let mut verification_results = Vec::new();
    let mut stats = VerificationStats::default();

    for result in results {
        match result {
            Ok(r) => {
                match r.classification {
                    0 => stats.not_human += 1,
                    1 => stats.human += 1,
                    _ => stats.unknown += 1,
                }
                verification_results.push(r);
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                stats.errors += 1;
            }
        }
    }

    // Build output
    let output = VerificationOutput {
        config: HFConfigSummary {
            model: config.model,
        },
        total_contacts: contacts.len(),
        processed: verification_results.len(),
        results: verification_results,
        stats,
    };

    // Write to JSON file
    match write_json_output(&output, output_path) {
        Ok(_) => eprintln!("Results written to {}", output_path),
        Err(e) => eprintln!("Error writing output: {}", e),
    }

    // Print summary
    eprintln!("\n=== Summary ===");
    eprintln!("Total contacts: {}", output.total_contacts);
    eprintln!("Processed: {}", output.processed);
    eprintln!("  Human (1): {}", output.stats.human);
    eprintln!("  Not Human (0): {}", output.stats.not_human);
    eprintln!("  Unknown (2 - tie vote): {}", output.stats.unknown);
    eprintln!("  Errors: {}", output.stats.errors);
}

fn print_usage() {
    eprintln!("Usage: verify_contacts <contacts_db_path> [output_json_path]");
    eprintln!();
    eprintln!("Arguments:");
    eprintln!("  contacts_db_path   Path to contacts.db file");
    eprintln!("  output_json_path   Path for output JSON file (default: data/verification_results.json)");
    eprintln!();
    eprintln!("Environment variables:");
    eprintln!("  HF_API_KEY         Hugging Face API key (required)");
    eprintln!("  HF_MODEL           Model ID (default: meta-llama/Llama-3.1-8B-Instruct)");
    eprintln!("  HF_TIMEOUT         Request timeout in seconds (default: 120)");
    eprintln!("  HF_BATCH_SIZE      Contacts per request (default: 50)");
    eprintln!("  HF_MAX_CONCURRENT  Max concurrent API requests (default: 8)");
}

fn write_json_output(output: &VerificationOutput, path: &str) -> Result<(), String> {
    let json = serde_json::to_string_pretty(output)
        .map_err(|e| format!("Failed to serialize: {}", e))?;

    let mut file = File::create(path)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}
