mod models;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    eprintln!("fill_events: scaffold");
}
