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
        Ok(dict.into())
    }

    fn __repr__(&self) -> String {
        format!(
            "ContactData(email='{}', received={}, sent={})",
            self.email, self.received_count, self.sent_count
        )
    }
}

/// Internal contact accumulator for merging partial results.
#[derive(Default)]
pub struct ContactAccumulator {
    pub name: String,
    pub received: u32,
    pub sent: u32,
}

/// Convert internal accumulator map to a sorted `Vec<ContactData>`.
pub fn convert_to_contact_data(map: HashMap<String, ContactAccumulator>) -> Vec<ContactData> {
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

    contacts.sort_by(|a, b| b.total_count().cmp(&a.total_count()));
    contacts
}
