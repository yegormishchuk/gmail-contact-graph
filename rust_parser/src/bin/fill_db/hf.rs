use futures::future::join_all;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::sleep;

/// Contact data for verification
#[derive(Debug, Clone)]
pub struct ContactForVerification {
    pub name: String,
    pub email: String,
}

/// Classification result
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ContactClassification {
    NotHuman = 0,
    Human = 1,
    Unknown = 2,
}

impl ContactClassification {
    pub fn as_u8(&self) -> u8 {
        *self as u8
    }
}

/// Verification result for a single contact
#[derive(Debug, Clone)]
pub struct VerificationResult {
    pub email: String,
    pub classification: u8,
}

/// HF Configuration
#[derive(Debug, Clone)]
pub struct HFConfig {
    pub api_key: String,
    pub model: String,
    pub timeout_secs: u64,
    pub batch_size: usize,
}

impl HFConfig {
    pub fn from_env() -> Result<Self, String> {
        let api_key = std::env::var("HF_API_KEY")
            .map_err(|_| "HF_API_KEY environment variable not set")?;

        let model = std::env::var("HF_MODEL")
            .unwrap_or_else(|_| "moonshotai/Kimi-K2.5".to_string());

        let timeout_secs = std::env::var("HF_TIMEOUT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(120);

        let batch_size = std::env::var("HF_BATCH_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(250);

        Ok(Self {
            api_key,
            model,
            timeout_secs,
            batch_size,
        })
    }

    pub fn api_url(&self) -> String {
        "https://router.huggingface.co/v1/chat/completions".to_string()
    }
}

/// OpenAI-compatible chat request
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// OpenAI-compatible chat response
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
    error: Option<ApiError>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: String,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    message: String,
}

/// Number of times to run each batch for voting
const VOTES_PER_BATCH: usize = 4;

/// Max retries if model returns incomplete response
const MAX_RETRIES: usize = 2;

/// Delay between requests in milliseconds (rate limiting)
const REQUEST_DELAY_MS: u64 = 200;

/// Default max concurrent requests
const DEFAULT_MAX_CONCURRENT: usize = 4;

/// HuggingFace API client (async)
pub struct HFClient {
    client: Client,
    config: HFConfig,
    semaphore: Arc<Semaphore>,
}

impl HFClient {
    /// Create a new HF client with concurrency limit
    pub fn new(config: HFConfig) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()?;

        Ok(Self {
            client,
            config,
            semaphore: Arc::new(Semaphore::new(DEFAULT_MAX_CONCURRENT)),
        })
    }

    /// Build batch prompt for multiple contacts
    fn build_batch_prompt(contacts: &[ContactForVerification]) -> String {
        let mut prompt = String::from(
            r#"Classify each email contact as a personal human account (1) or not (0).

HUMAN (1) - Personal email accounts:
- Individual's name @gmail.com, @yahoo.com, @outlook.com, etc.
- Pattern: firstname.lastname@, firstnamelastname@, nickname@
- Examples: john.smith@gmail.com, sarahj@yahoo.com

NOT HUMAN (0) - Everything else:
- Business/organization emails (info@, contact@, support@, hello@)
- Company domains (@company.com, @businessname.co)
- Newsletters, services, automated systems (noreply@, newsletter@)
- Generic/role-based addresses (admin@, sales@, team@)

Reply with ONLY comma-separated numbers (0 or 1) in the same order as the contacts listed.

Contacts:

"#,
        );

        for (i, contact) in contacts.iter().enumerate() {
            prompt.push_str(&format!(
                "{}. Name: \"{}\" Email: <{}>\n",
                i + 1,
                contact.name,
                contact.email,
            ));
        }

        prompt.push_str("\nAnswer (comma-separated 0/1):");
        prompt
    }

    /// Parse batch response into individual classifications
    fn parse_batch_response(response: &str, count: usize) -> Option<Vec<ContactClassification>> {
        let mut results = Vec::with_capacity(count);

        for ch in response.chars() {
            match ch {
                '0' => results.push(ContactClassification::NotHuman),
                '1' => results.push(ContactClassification::Human),
                _ => continue,
            }
            if results.len() >= count {
                break;
            }
        }

        if results.len() < count {
            return None;
        }

        Some(results)
    }

    /// Single API request
    async fn make_api_request(
        &self,
        contacts: &[ContactForVerification],
    ) -> Result<String, String> {
        let _permit = self
            .semaphore
            .acquire()
            .await
            .map_err(|e| format!("Semaphore error: {}", e))?;

        let max_tokens = (contacts.len() * 3 + 50).max(100) as u32;

        let request = ChatRequest {
            model: self.config.model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: Self::build_batch_prompt(contacts),
            }],
            temperature: 0.1,
            max_tokens,
        };

        let url = self.config.api_url();

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        if let Some(error) = chat_response.error {
            return Err(format!("API error: {}", error.message));
        }

        let result = chat_response
            .choices
            .and_then(|c| c.into_iter().next())
            .map(|c| c.message.content)
            .unwrap_or_default();

        sleep(Duration::from_millis(REQUEST_DELAY_MS)).await;

        Ok(result)
    }

    /// Single API call with retry on incomplete response
    async fn classify_batch_once(
        &self,
        contacts: &[ContactForVerification],
    ) -> Result<Vec<ContactClassification>, String> {
        let count = contacts.len();

        for attempt in 0..=MAX_RETRIES {
            let raw_response = self.make_api_request(contacts).await?;

            if let Some(results) = Self::parse_batch_response(&raw_response, count) {
                return Ok(results);
            }

            if attempt < MAX_RETRIES {
                eprintln!("  [WARN] Incomplete response, retrying ({}/{})", attempt + 1, MAX_RETRIES);
                continue;
            }
        }

        Err(format!(
            "Model returned incomplete response after {} retries",
            MAX_RETRIES
        ))
    }

    /// Vote on classification (unanimous required)
    fn vote_classification(votes: &[ContactClassification]) -> ContactClassification {
        let mut count_0: usize = 0;
        let mut count_1: usize = 0;

        for vote in votes {
            match vote {
                ContactClassification::NotHuman => count_0 += 1,
                ContactClassification::Human => count_1 += 1,
                ContactClassification::Unknown => {}
            }
        }

        if count_0 == VOTES_PER_BATCH {
            ContactClassification::NotHuman
        } else if count_1 == VOTES_PER_BATCH {
            ContactClassification::Human
        } else {
            ContactClassification::Unknown
        }
    }

    /// Classify a batch with voting
    async fn classify_batch_with_voting(
        &self,
        contacts: &[ContactForVerification],
    ) -> Vec<Result<VerificationResult, String>> {
        let mut vote_results: Vec<Vec<ContactClassification>> = Vec::new();
        let mut total_attempts = 0;
        const MAX_TOTAL_ATTEMPTS: usize = 20;

        while vote_results.len() < VOTES_PER_BATCH && total_attempts < MAX_TOTAL_ATTEMPTS {
            let needed = VOTES_PER_BATCH - vote_results.len();

            let futures: Vec<_> = (0..needed)
                .map(|_| self.classify_batch_once(contacts))
                .collect();

            let results = join_all(futures).await;
            total_attempts += needed;

            for result in results {
                match result {
                    Ok(classifications) => {
                        vote_results.push(classifications);
                        if vote_results.len() >= VOTES_PER_BATCH {
                            break;
                        }
                    }
                    Err(e) => {
                        eprintln!("  [ERROR] API call failed: {}", e);
                    }
                }
            }
        }

        if vote_results.len() < VOTES_PER_BATCH {
            return contacts
                .iter()
                .map(|c| Err(format!(
                    "Could not collect {} votes for {} after {} attempts",
                    VOTES_PER_BATCH, c.email, total_attempts
                )))
                .collect();
        }

        contacts
            .iter()
            .enumerate()
            .map(|(i, contact)| {
                let votes: Vec<ContactClassification> = vote_results
                    .iter()
                    .filter_map(|results| results.get(i).copied())
                    .collect();

                let classification = Self::vote_classification(&votes);

                Ok(VerificationResult {
                    email: contact.email.clone(),
                    classification: classification.as_u8(),
                })
            })
            .collect()
    }

    /// Classify all contacts in batches
    pub async fn classify_all(
        &self,
        contacts: &[ContactForVerification],
    ) -> Vec<Result<VerificationResult, String>> {
        let batch_size = self.config.batch_size;
        let total_batches = (contacts.len() + batch_size - 1) / batch_size;
        let batches: Vec<Vec<ContactForVerification>> = contacts
            .chunks(batch_size)
            .map(|c| c.to_vec())
            .collect();

        let futures: Vec<_> = batches
            .into_iter()
            .enumerate()
            .map(|(batch_idx, chunk)| {
                let chunk_len = chunk.len();
                async move {
                    eprintln!("  [Batch {}/{}] Processing {} contacts...", batch_idx + 1, total_batches, chunk_len);
                    self.classify_batch_with_voting(&chunk).await
                }
            })
            .collect();

        let all_batch_results = join_all(futures).await;
        all_batch_results.into_iter().flatten().collect()
    }
}
