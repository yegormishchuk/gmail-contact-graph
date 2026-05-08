mod models;
mod parsing;
mod recurrence;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    eprintln!("fill_events: scaffold");
}
