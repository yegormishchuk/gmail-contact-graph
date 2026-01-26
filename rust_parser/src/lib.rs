//! Fast mbox parser with Python bindings via PyO3.
//!
//! Provides high-performance mbox parsing with:
//! - Memory-mapped file access
//! - Parallel processing via Rayon
//! - MIME header decoding (Base64, Quoted-Printable)

use pyo3::prelude::*;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};

/// Contact information extracted from emails.
#[pyclass]
#[derive(Clone, Debug)]
pub struct ContactData {
    #[pyo3(get)]
    pub name: String,
    #[pyo3(get)]
    pub email: String,
    #[pyo3(get)]
    pub received_count: u32,
    #[pyo3(get)]
    pub sent_count: u32,
}

#[pymethods]
impl ContactData {
    #[getter]
    fn total_count(&self) -> u32 {
        self.received_count + self.sent_count
    }

    fn to_dict(&self, py: Python<'_>) -> PyResult<PyObject> {
        let dict = pyo3::types::PyDict::new_bound(py);
        dict.set_item("name", &self.name)?;
        dict.set_item("email", &self.email)?;
        dict.set_item("received", self.received_count)?;
        dict.set_item("sent", self.sent_count)?;
        Ok(dict.into())
    }

    fn __repr__(&self) -> String {
        format!(
            "ContactData(email='{}', received={}, sent={})",
            self.email, self.received_count, self.sent_count
        )
    }
}

/// Decode MIME encoded-word header (=?charset?encoding?data?=)
fn decode_mime_header(text: &str) -> String {
    let mut result = String::new();
    let mut remaining = text;
    let mut last_was_encoded = false;

    while let Some(start) = remaining.find("=?") {
        let between = &remaining[..start];
        // RFC 2047: whitespace between adjacent encoded words is ignored
        if last_was_encoded && between.chars().all(|c| c == ' ' || c == '\t') {
            // skip whitespace between encoded words
        } else {
            result.push_str(between);
        }
        remaining = &remaining[start..];

        // Parse =?charset?encoding?data?= by finding delimiters sequentially
        let inner = &remaining[2..]; // skip "=?"

        // Find end of charset (first '?')
        let charset_end = match inner.find('?') {
            Some(pos) => pos,
            None => {
                result.push_str("=?");
                remaining = &remaining[2..];
                last_was_encoded = false;
                continue;
            }
        };
        let charset = &inner[..charset_end];

        // Find end of encoding (next '?')
        let after_charset = &inner[charset_end + 1..];
        let encoding_end = match after_charset.find('?') {
            Some(pos) => pos,
            None => {
                result.push_str("=?");
                remaining = &remaining[2..];
                last_was_encoded = false;
                continue;
            }
        };
        let encoding = &after_charset[..encoding_end];

        // Find end of data ("?=" after the data section)
        let data_start = &after_charset[encoding_end + 1..];
        let data_end = match data_start.find("?=") {
            Some(pos) => pos,
            None => {
                result.push_str(remaining);
                remaining = "";
                last_was_encoded = false;
                break;
            }
        };
        let data = &data_start[..data_end];

        // Advance past the entire encoded word
        let total_len = 2 + charset_end + 1 + encoding_end + 1 + data_end + 2;
        remaining = &remaining[total_len..];

        let encoding_upper = encoding.to_uppercase();
        let decoded_bytes = match encoding_upper.as_str() {
            "B" => base64_decode(data),
            "Q" => quoted_printable_decode(data),
            _ => None,
        };

        if let Some(bytes) = decoded_bytes {
            result.push_str(&decode_charset(&bytes, charset));
            last_was_encoded = true;
        } else {
            // Could not decode, keep original
            result.push_str(&text[start..start + total_len]);
            last_was_encoded = false;
        }
    }

    if last_was_encoded && remaining.chars().all(|c| c == ' ' || c == '\t') {
        // trailing whitespace after last encoded word — keep it
        result.push_str(remaining);
    } else {
        result.push_str(remaining);
    }
    result
}

/// Decode base64 data
fn base64_decode(data: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()
}

/// Decode quoted-printable data (for MIME headers, _ = space)
fn quoted_printable_decode(data: &str) -> Option<Vec<u8>> {
    let mut result = Vec::new();
    let mut chars = data.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '_' => result.push(b' '), // In headers, underscore means space
            '=' => {
                let hex: String = chars.by_ref().take(2).collect();
                if hex.len() == 2 {
                    if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                        result.push(byte);
                    }
                }
            }
            _ => result.push(c as u8),
        }
    }

    Some(result)
}

/// Decode bytes using specified charset
fn decode_charset(bytes: &[u8], charset: &str) -> String {
    let charset_lower = charset.to_lowercase();
    let encoding = match charset_lower.as_str() {
        "utf-8" | "utf8" => encoding_rs::UTF_8,
        "iso-8859-1" | "latin1" | "latin-1" => encoding_rs::WINDOWS_1252,
        "iso-8859-2" | "latin2" | "latin-2" => encoding_rs::ISO_8859_2,
        "windows-1251" | "cp1251" => encoding_rs::WINDOWS_1251,
        "windows-1252" | "cp1252" => encoding_rs::WINDOWS_1252,
        "koi8-r" => encoding_rs::KOI8_R,
        "koi8-u" => encoding_rs::KOI8_U,
        "gb2312" | "gbk" | "gb18030" => encoding_rs::GB18030,
        "big5" => encoding_rs::BIG5,
        "shift_jis" | "shift-jis" | "sjis" => encoding_rs::SHIFT_JIS,
        "euc-jp" => encoding_rs::EUC_JP,
        "euc-kr" => encoding_rs::EUC_KR,
        "iso-2022-jp" => encoding_rs::ISO_2022_JP,
        _ => encoding_rs::UTF_8,
    };

    let (decoded, _, _) = encoding.decode(bytes);
    decoded.into_owned()
}

/// Extract name and email from a "From: " line
fn parse_sender(line: &str) -> Option<(String, String)> {
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

/// Internal contact accumulator for merging
#[derive(Default)]
struct ContactAccumulator {
    name: String,
    received: u32,
    sent: u32,
}

/// Parse mbox file and return contacts (single-threaded version)
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
            // Convert To: line to From: format for parsing
            let fake_from = format!("From:{}", &decoded[3..]);
            if let Some((name, email)) = parse_sender(&fake_from) {
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

/// Find chunk boundaries aligned to message separators
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

/// Find the next mbox message boundary (line starting with "From ")
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

/// Parse a chunk of mbox data
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
            let fake_from = format!("From:{}", &decoded[3..]);
            if let Some((name, email)) = parse_sender(&fake_from) {
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

/// Merge multiple contact maps into one
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
fn parse_mbox(path: &str, my_email: &str, num_threads: usize) -> PyResult<Vec<ContactData>> {
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

/// Convert internal map to sorted ContactData vector
fn convert_to_contact_data(map: HashMap<String, ContactAccumulator>) -> Vec<ContactData> {
    let mut contacts: Vec<ContactData> = map
        .into_iter()
        .map(|(email, acc)| ContactData {
            name: if acc.name.is_empty() {
                email.split('@').next().unwrap_or(&email).to_string()
            } else {
                acc.name
            },
            email,
            received_count: acc.received,
            sent_count: acc.sent,
        })
        .collect();

    // Sort by total count (descending)
    contacts.sort_by(|a, b| b.total_count().cmp(&a.total_count()));

    contacts
}

/// Parse mbox and return as Python dicts (for compatibility with existing code).
///
/// Returns:
///     Dict with "senders" and "recipients" lists
#[pyfunction]
#[pyo3(signature = (path, my_email, num_threads=0))]
fn parse_mbox_to_dict(
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

/// Get the number of available CPU threads
#[pyfunction]
fn get_num_threads() -> usize {
    rayon::current_num_threads()
}

/// Python module definition
#[pymodule]
fn fast_mbox_parser(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<ContactData>()?;
    m.add_function(wrap_pyfunction!(parse_mbox, m)?)?;
    m.add_function(wrap_pyfunction!(parse_mbox_to_dict, m)?)?;
    m.add_function(wrap_pyfunction!(get_num_threads, m)?)?;
    Ok(())
}
