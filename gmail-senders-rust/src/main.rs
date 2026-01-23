use anyhow::{anyhow, Context, Result};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Arc;
use std::time::Instant;
use tiny_http::{Response, Server};
use url::Url;

const CREDENTIALS_FILE: &str = "credentials.json";
const TOKEN_FILE: &str = "token.json";
const REDIRECT_URI: &str = "http://localhost:8080/callback";
const SCOPES: &str = "https://www.googleapis.com/auth/gmail.readonly";

// Количество параллельных запросов
const CONCURRENT_REQUESTS: usize = 300;

// ==================== OAuth Structures ====================

#[derive(Deserialize)]
struct ClientCredentials {
    web: WebCredentials,
}

#[derive(Deserialize)]
struct WebCredentials {
    client_id: String,
    client_secret: String,
}

#[derive(Serialize, Deserialize)]
struct TokenData {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<i64>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

// ==================== Gmail API Structures ====================

#[derive(Deserialize)]
struct MessageList {
    messages: Option<Vec<MessageRef>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize, Clone)]
struct MessageRef {
    id: String,
}

#[derive(Deserialize)]
struct Message {
    payload: Option<Payload>,
}

#[derive(Deserialize)]
struct Payload {
    headers: Option<Vec<Header>>,
}

#[derive(Deserialize)]
struct Header {
    name: String,
    value: String,
}

// ==================== Output Structure ====================

#[derive(Serialize)]
struct SendersOutput {
    count: usize,
    senders: Vec<String>,
}

// ==================== OAuth Implementation ====================

fn load_credentials() -> Result<(String, String)> {
    let content = fs::read_to_string(CREDENTIALS_FILE)
        .context(format!("Не найден файл '{}'. Скачайте OAuth credentials из Google Cloud Console.", CREDENTIALS_FILE))?;

    let creds: ClientCredentials = serde_json::from_str(&content)?;
    Ok((creds.web.client_id, creds.web.client_secret))
}

fn load_token() -> Option<TokenData> {
    fs::read_to_string(TOKEN_FILE)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

fn save_token(token: &TokenData) -> Result<()> {
    let content = serde_json::to_string_pretty(token)?;
    fs::write(TOKEN_FILE, content)?;
    println!("Токен сохранен в '{}'", TOKEN_FILE);
    Ok(())
}

fn build_auth_url(client_id: &str) -> String {
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
         client_id={}&\
         redirect_uri={}&\
         response_type=code&\
         scope={}&\
         access_type=offline&\
         prompt=consent",
        client_id,
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode(SCOPES)
    )
}

fn wait_for_callback() -> Result<String> {
    let server = Server::http("127.0.0.1:8080")
        .map_err(|e| anyhow!("Не удалось запустить сервер: {}", e))?;

    println!("Ожидание авторизации...");

    let request = server.recv()?;
    let url = format!("http://localhost{}", request.url());
    let parsed = Url::parse(&url)?;

    let code = parsed
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string())
        .ok_or_else(|| anyhow!("Код авторизации не получен"))?;

    let response = Response::from_string(
        "<html><body><h1>Авторизация успешна!</h1><p>Можете закрыть это окно.</p></body></html>"
    ).with_header(
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap()
    );
    request.respond(response)?;

    Ok(code)
}

async fn exchange_code(client_id: &str, client_secret: &str, code: &str) -> Result<TokenData> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", REDIRECT_URI),
        ])
        .send()
        .await?
        .json::<TokenResponse>()
        .await?;

    let expires_at = response.expires_in.map(|secs| {
        chrono::Utc::now().timestamp() + secs
    });

    Ok(TokenData {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at,
    })
}

async fn refresh_token(client_id: &str, client_secret: &str, refresh_token: &str) -> Result<TokenData> {
    let client = reqwest::Client::new();

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await?
        .json::<TokenResponse>()
        .await?;

    let expires_at = response.expires_in.map(|secs| {
        chrono::Utc::now().timestamp() + secs
    });

    Ok(TokenData {
        access_token: response.access_token,
        refresh_token: response.refresh_token.or_else(|| Some(refresh_token.to_string())),
        expires_at,
    })
}

async fn authenticate() -> Result<String> {
    let (client_id, client_secret) = load_credentials()?;

    // Проверяем существующий токен
    if let Some(token) = load_token() {
        let now = chrono::Utc::now().timestamp();
        let is_expired = token.expires_at.map(|exp| now >= exp - 60).unwrap_or(true);

        if !is_expired {
            return Ok(token.access_token);
        }

        // Пробуем обновить токен
        if let Some(ref rt) = token.refresh_token {
            println!("Обновление токена...");
            match refresh_token(&client_id, &client_secret, rt).await {
                Ok(new_token) => {
                    save_token(&new_token)?;
                    return Ok(new_token.access_token);
                }
                Err(e) => println!("Не удалось обновить токен: {}", e),
            }
        }
    }

    // Полная авторизация
    println!("Требуется авторизация...");
    let auth_url = build_auth_url(&client_id);

    println!("Открываю браузер...");
    println!("Если браузер не открылся, перейдите по ссылке:\n{}\n", auth_url);
    let _ = open::that(&auth_url);

    let code = wait_for_callback()?;

    let token = exchange_code(&client_id, &client_secret, &code).await?;
    save_token(&token)?;

    Ok(token.access_token)
}

// ==================== Gmail API Implementation ====================

async fn get_message_ids(client: &reqwest::Client, token: &str, max_results: u32) -> Result<Vec<String>> {
    let mut all_ids = Vec::new();
    let mut page_token: Option<String> = None;

    println!("Получение списка писем...");

    loop {
        let mut url = format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults={}",
            max_results.min(500)
        );

        if let Some(ref pt) = page_token {
            url.push_str(&format!("&pageToken={}", pt));
        }

        let response: MessageList = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await?
            .json()
            .await?;

        if let Some(messages) = response.messages {
            all_ids.extend(messages.into_iter().map(|m| m.id));
        }

        if all_ids.len() >= max_results as usize {
            all_ids.truncate(max_results as usize);
            break;
        }

        match response.next_page_token {
            Some(pt) => page_token = Some(pt),
            None => break,
        }
    }

    println!("Найдено {} писем", all_ids.len());
    Ok(all_ids)
}

async fn get_sender(client: &reqwest::Client, token: &str, message_id: &str) -> Result<Option<String>> {
    let url = format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/{}?format=metadata&metadataHeaders=From",
        message_id
    );

    let response: Message = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await?
        .json()
        .await?;

    let sender = response
        .payload
        .and_then(|p| p.headers)
        .and_then(|headers| {
            headers.into_iter()
                .find(|h| h.name.eq_ignore_ascii_case("From"))
                .map(|h| h.value)
        });

    Ok(sender)
}

async fn get_senders(token: &str, max_results: u32) -> Result<Vec<String>> {
    let start_time = Instant::now();

    let client = reqwest::Client::new();
    let message_ids = get_message_ids(&client, token, max_results).await?;

    println!("Извлекаю отправителей ({} параллельных запросов)...", CONCURRENT_REQUESTS);

    let client = Arc::new(client);
    let token = Arc::new(token.to_string());
    let total = message_ids.len();
    let processed = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    let senders: Vec<Option<String>> = stream::iter(message_ids)
        .map(|id| {
            let client = Arc::clone(&client);
            let token = Arc::clone(&token);
            let processed = Arc::clone(&processed);

            async move {
                let result = get_sender(&client, &token, &id).await.ok().flatten();

                let count = processed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if count % 100 == 0 || count == total {
                    println!("  Обработано {}/{}", count, total);
                }

                result
            }
        })
        .buffer_unordered(CONCURRENT_REQUESTS)
        .collect()
        .await;

    let elapsed = start_time.elapsed();
    let senders: Vec<String> = senders.into_iter().flatten().collect();

    println!(
        "\nГотово! Обработано {} писем за {:.2} сек ({:.1} писем/сек)",
        senders.len(),
        elapsed.as_secs_f64(),
        senders.len() as f64 / elapsed.as_secs_f64()
    );

    Ok(senders)
}

fn save_senders_to_json(senders: &[String], filename: &str) -> Result<()> {
    let output = SendersOutput {
        count: senders.len(),
        senders: senders.to_vec(),
    };

    let content = serde_json::to_string_pretty(&output)?;
    fs::write(filename, content)?;
    println!("Сохранено {} отправителей в '{}'", senders.len(), filename);

    Ok(())
}

// ==================== Main ====================

#[tokio::main]
async fn main() -> Result<()> {
    let token = authenticate().await?;
    let senders = get_senders(&token, 3000).await?;
    save_senders_to_json(&senders, "senders.json")?;

    Ok(())
}
