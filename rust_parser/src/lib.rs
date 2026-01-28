//! Fast mbox parser with Python bindings via PyO3.
//!
//! Provides high-performance mbox parsing with:
//! - Memory-mapped file access
//! - Parallel processing via Rayon
//! - MIME header decoding (Base64, Quoted-Printable)

use pyo3::prelude::*;

mod contact;
pub mod email;
mod groups;
pub mod mime;
mod parser;

/// Python module definition.
#[pymodule]
fn fast_mbox_parser(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<contact::ContactData>()?;
    m.add_function(wrap_pyfunction!(parser::parse_mbox, m)?)?;
    m.add_function(wrap_pyfunction!(parser::parse_mbox_to_dict, m)?)?;
    m.add_function(wrap_pyfunction!(parser::get_num_threads, m)?)?;
    m.add_function(wrap_pyfunction!(groups::parse_message_groups, m)?)?;
    Ok(())
}
