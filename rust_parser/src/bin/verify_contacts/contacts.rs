use rusqlite::Connection;

use crate::config::ContactForVerification;

/// Load contacts from the database that passed the initial spam filter
/// (i.e., contacts that are in contacts_filtered table)
pub fn load_filtered_contacts(db_path: &str) -> Result<Vec<ContactForVerification>, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database {}: {}", db_path, e))?;

    let mut stmt = conn
        .prepare("SELECT name, email, received, sent FROM contacts_filtered")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let contacts_iter = stmt
        .query_map([], |row| {
            Ok(ContactForVerification {
                name: row.get(0)?,
                email: row.get(1)?,
                received: row.get(2)?,
                sent: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to execute query: {}", e))?;

    let mut contacts = Vec::new();
    for contact_result in contacts_iter {
        match contact_result {
            Ok(contact) => contacts.push(contact),
            Err(e) => eprintln!("Warning: skipping contact due to error: {}", e),
        }
    }

    Ok(contacts)
}

/// Load all contacts from the main contacts table (before spam filtering)
pub fn load_all_contacts(db_path: &str) -> Result<Vec<ContactForVerification>, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database {}: {}", db_path, e))?;

    let mut stmt = conn
        .prepare("SELECT name, email, received, sent FROM contacts")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let contacts_iter = stmt
        .query_map([], |row| {
            Ok(ContactForVerification {
                name: row.get(0)?,
                email: row.get(1)?,
                received: row.get(2)?,
                sent: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to execute query: {}", e))?;

    let mut contacts = Vec::new();
    for contact_result in contacts_iter {
        match contact_result {
            Ok(contact) => contacts.push(contact),
            Err(e) => eprintln!("Warning: skipping contact due to error: {}", e),
        }
    }

    Ok(contacts)
}
