use pyo3::prelude::*;
use std::collections::HashMap;

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
    #[pyo3(get)]
    pub first_email_date: Option<String>,
    #[pyo3(get)]
    pub last_email_date: Option<String>,
    #[pyo3(get)]
    pub emails_per_month: Option<f64>,
}

#[pymethods]
impl ContactData {
    #[getter]
    pub fn total_count(&self) -> u32 {
        self.received_count + self.sent_count
    }

    pub fn to_dict(&self, py: Python<'_>) -> PyResult<PyObject> {
        let dict = pyo3::types::PyDict::new_bound(py);
        dict.set_item("name", &self.name)?;
        dict.set_item("email", &self.email)?;
        dict.set_item("received", self.received_count)?;
        dict.set_item("sent", self.sent_count)?;
        dict.set_item("first_email_date", &self.first_email_date)?;
        dict.set_item("last_email_date", &self.last_email_date)?;
        dict.set_item("emails_per_month", self.emails_per_month)?;
        Ok(dict.into())
    }

    fn __repr__(&self) -> String {
        format!(
            "ContactData(email='{}', received={}, sent={}, first={:?}, last={:?}, per_month={:?})",
            self.email, self.received_count, self.sent_count,
            self.first_email_date, self.last_email_date, self.emails_per_month
        )
    }
}

/// Internal contact accumulator for merging partial results.
#[derive(Default)]
pub struct ContactAccumulator {
    pub name: String,
    pub received: u32,
    pub sent: u32,
    /// Timestamp of first email (Unix seconds)
    pub first_timestamp: Option<i64>,
    /// Timestamp of last email (Unix seconds)
    pub last_timestamp: Option<i64>,
}

impl ContactAccumulator {
    /// Update timestamps with a new email date
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

/// Format Unix timestamp as ISO date string (YYYY-MM-DD)
fn format_date(timestamp: i64) -> String {
    use chrono::{TimeZone, Utc};
    Utc.timestamp_opt(timestamp, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Calculate emails per month given first/last timestamps and total count
fn calculate_emails_per_month(first: i64, last: i64, total: u32) -> f64 {
    if first >= last {
        // All emails in same month or invalid range
        return total as f64;
    }

    // Calculate months between first and last
    let days = (last - first) as f64 / (24.0 * 60.0 * 60.0);
    let months = days / 30.44; // Average days per month

    if months < 1.0 {
        total as f64
    } else {
        (total as f64 / months * 100.0).round() / 100.0
    }
}

/// Convert internal accumulator map to a sorted `Vec<ContactData>`.
pub fn convert_to_contact_data(map: HashMap<String, ContactAccumulator>) -> Vec<ContactData> {
    let mut contacts: Vec<ContactData> = map
        .into_iter()
        .map(|(email, acc)| {
            let total = acc.received + acc.sent;
            let (first_email_date, last_email_date, emails_per_month) =
                match (acc.first_timestamp, acc.last_timestamp) {
                    (Some(first), Some(last)) => (
                        Some(format_date(first)),
                        Some(format_date(last)),
                        Some(calculate_emails_per_month(first, last, total)),
                    ),
                    _ => (None, None, None),
                };

            ContactData {
                name: if acc.name.is_empty() {
                    email.split('@').next().unwrap_or(&email).to_string()
                } else {
                    acc.name
                },
                email,
                received_count: acc.received,
                sent_count: acc.sent,
                first_email_date,
                last_email_date,
                emails_per_month,
            }
        })
        .collect();

    contacts.sort_by(|a, b| b.total_count().cmp(&a.total_count()));
    contacts
}
