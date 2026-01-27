use pyo3::prelude::*;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};

use crate::contact::{convert_to_contact_data, ContactAccumulator, ContactData};
use crate::email::{parse_all_recipients, parse_sender};
use crate::mime::decode_mime_header;

/// Parse mbox file and return contacts (single-threaded version).
fn parse_mbox_single(path: &str, my_email: &str) -> HashMap<String, ContactAccumulator> {
    let my_email = my_email.to_lowercase();
    let mut contacts: HashMap<String, ContactAccumulator> = HashMap::new();

    let file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return contacts,
    };

    let reader = BufReader::with_capacity(1024 * 1024, file); // 1MB buffer
    let mut looking_for_to = false;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            looking_for_to = false;
            continue;
        }

        if line.starts_with("From:") {
            let decoded = decode_mime_header(&line);
            if let Some((name, email)) = parse_sender(&decoded) {
                if email == my_email {
                    looking_for_to = true;
                } else {
                    looking_for_to = false;
                    let entry = contacts.entry(email).or_default();
                    entry.received += 1;
                    if entry.name.is_empty() {
                        entry.name = name;
                    }
                }
            }
        } else if looking_for_to && line.starts_with("To:") {
            let decoded = decode_mime_header(&line);
            let content = decoded.get(3..).unwrap_or("");
            for (name, email) in parse_all_recipients(content) {
                let entry = contacts.entry(email).or_default();
                entry.sent += 1;
                if entry.name.is_empty() {
                    entry.name = name;
                }
            }
            looking_for_to = false;
        }
    }

    contacts
}

/// Find chunk boundaries aligned to message separators.
fn find_chunk_boundaries(data: &[u8], num_chunks: usize) -> Vec<(usize, usize)> {
    let chunk_size = data.len() / num_chunks;
    let mut boundaries = Vec::with_capacity(num_chunks);

    let mut start = 0;
    for i in 0..num_chunks {
        let end = if i == num_chunks - 1 {
            data.len()
        } else {
            let approx_end = ((i + 1) * chunk_size).min(data.len());
            // Find next "From " at line start (mbox message separator)
            find_next_message_boundary(data, approx_end).unwrap_or(data.len())
        };

        if start < end {
            boundaries.push((start, end));
        }
        start = end;
    }

    boundaries
}

/// Find the next mbox message boundary (line starting with "From ").
fn find_next_message_boundary(data: &[u8], from: usize) -> Option<usize> {
    let search_pattern = b"\nFrom ";
    let mut pos = from;

    while pos < data.len() {
        if let Some(found) = data[pos..].windows(6).position(|w| w == search_pattern) {
            return Some(pos + found + 1); // +1 to skip the newline
        }
        pos += 1024; // Jump ahead in chunks
    }

    None
}

/// Parse a chunk of mbox data.
fn parse_chunk(data: &[u8], my_email: &str) -> HashMap<String, ContactAccumulator> {
    let my_email = my_email.to_lowercase();
    let mut contacts: HashMap<String, ContactAccumulator> = HashMap::new();
    let mut looking_for_to = false;

    // Convert to string, handling invalid UTF-8
    let text = String::from_utf8_lossy(data);

    for line in text.lines() {
        if line.trim().is_empty() {
            looking_for_to = false;
            continue;
        }

        if line.starts_with("From:") {
            let decoded = decode_mime_header(line);
            if let Some((name, email)) = parse_sender(&decoded) {
                if email == my_email {
                    looking_for_to = true;
                } else {
                    looking_for_to = false;
                    let entry = contacts.entry(email).or_default();
                    entry.received += 1;
                    if entry.name.is_empty() {
                        entry.name = name;
                    }
                }
            }
        } else if looking_for_to && line.starts_with("To:") {
            let decoded = decode_mime_header(line);
            let content = decoded.get(3..).unwrap_or("");
            for (name, email) in parse_all_recipients(content) {
                let entry = contacts.entry(email).or_default();
                entry.sent += 1;
                if entry.name.is_empty() {
                    entry.name = name;
                }
            }
            looking_for_to = false;
        }
    }

    contacts
}

/// Merge multiple contact maps into one.
fn merge_contacts(
    maps: Vec<HashMap<String, ContactAccumulator>>,
) -> HashMap<String, ContactAccumulator> {
    let mut result: HashMap<String, ContactAccumulator> = HashMap::new();

    for map in maps {
        for (email, acc) in map {
            let entry = result.entry(email).or_default();
            entry.received += acc.received;
            entry.sent += acc.sent;
            if entry.name.is_empty() && !acc.name.is_empty() {
                entry.name = acc.name;
            }
        }
    }

    result
}

/// Parse mbox file with parallel processing.
///
/// Args:
///     path: Path to the mbox file
///     my_email: Your email address (to identify sent vs received)
///     num_threads: Number of threads (0 = auto-detect)
///
/// Returns:
///     List of ContactData sorted by total activity (descending)
#[pyfunction]
#[pyo3(signature = (path, my_email, num_threads=0))]
pub fn parse_mbox(path: &str, my_email: &str, num_threads: usize) -> PyResult<Vec<ContactData>> {
    let file = File::open(path).map_err(|e| {
        pyo3::exceptions::PyIOError::new_err(format!("Failed to open file: {}", e))
    })?;

    let metadata = file.metadata().map_err(|e| {
        pyo3::exceptions::PyIOError::new_err(format!("Failed to get file metadata: {}", e))
    })?;

    let file_size = metadata.len() as usize;

    // For small files, use single-threaded parsing
    if file_size < 10 * 1024 * 1024 {
        // < 10MB
        let contacts_map = parse_mbox_single(path, my_email);
        return Ok(convert_to_contact_data(contacts_map));
    }

    // Memory-map the file for parallel processing
    let mmap = unsafe {
        memmap2::MmapOptions::new().map(&file).map_err(|e| {
            pyo3::exceptions::PyIOError::new_err(format!("Failed to mmap file: {}", e))
        })?
    };

    // Determine number of threads
    let num_threads = if num_threads == 0 {
        rayon::current_num_threads()
    } else {
        num_threads.min(rayon::current_num_threads())
    };

    // Find chunk boundaries
    let boundaries = find_chunk_boundaries(&mmap, num_threads);

    // Process chunks in parallel
    let results: Vec<HashMap<String, ContactAccumulator>> = boundaries
        .par_iter()
        .map(|(start, end)| parse_chunk(&mmap[*start..*end], my_email))
        .collect();

    // Merge results
    let contacts_map = merge_contacts(results);

    Ok(convert_to_contact_data(contacts_map))
}

/// Parse mbox and return as Python dicts (for compatibility with existing code).
///
/// Returns:
///     Dict with "senders" and "recipients" lists
#[pyfunction]
#[pyo3(signature = (path, my_email, num_threads=0))]
pub fn parse_mbox_to_dict(
    py: Python<'_>,
    path: &str,
    my_email: &str,
    num_threads: usize,
) -> PyResult<PyObject> {
    let contacts = parse_mbox(path, my_email, num_threads)?;

    let senders = pyo3::types::PyList::empty_bound(py);
    let recipients = pyo3::types::PyList::empty_bound(py);

    for contact in &contacts {
        if contact.received_count > 0 {
            let dict = pyo3::types::PyDict::new_bound(py);
            dict.set_item("name", &contact.name)?;
            dict.set_item("email", &contact.email)?;
            dict.set_item("count", contact.received_count)?;
            senders.append(dict)?;
        }

        if contact.sent_count > 0 {
            let dict = pyo3::types::PyDict::new_bound(py);
            dict.set_item("name", &contact.name)?;
            dict.set_item("email", &contact.email)?;
            dict.set_item("count", contact.sent_count)?;
            recipients.append(dict)?;
        }
    }

    let result = pyo3::types::PyDict::new_bound(py);
    result.set_item("senders", senders)?;
    result.set_item("recipients", recipients)?;

    Ok(result.into())
}

/// Get the number of available CPU threads.
#[pyfunction]
pub fn get_num_threads() -> usize {
    rayon::current_num_threads()
}
