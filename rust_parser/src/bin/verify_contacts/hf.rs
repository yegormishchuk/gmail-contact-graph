use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::config::{ContactClassification, ContactForVerification, HFConfig, VerificationResult};

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

/// HuggingFace API client
pub struct HFClient {
    client: Client,
    config: HFConfig,
}

impl HFClient {
    /// Create a new HF client
    pub fn new(config: HFConfig) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()?;

        Ok(Self { client, config })
    }

    /// Build batch prompt for multiple contacts
    fn build_batch_prompt(contacts: &[ContactForVerification]) -> String {
        let mut prompt = String::from(
            r#"Classify each email contact as human or not. Reply with ONLY comma-separated numbers:
0 = NOT human (services, centers, companies, etc.)
1 = HUMAN (real person)
2 = UNCLEAR
If you're not sure for 90%+ of the time, use 2

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

        prompt.push_str("\nAnswer (comma-separated 0/1/2):");
        prompt
    }

    /// Parse batch response into individual classifications
    fn parse_batch_response(response: &str, count: usize) -> Vec<ContactClassification> {
        let mut results = Vec::with_capacity(count);

        for ch in response.chars() {
            match ch {
                '0' => results.push(ContactClassification::NotHuman),
                '1' => results.push(ContactClassification::Human),
                '2' => results.push(ContactClassification::Unknown),
                _ => continue,
            }
            if results.len() >= count {
                break;
            }
        }

        while results.len() < count {
            results.push(ContactClassification::Unknown);
        }

        results
    }

    /// Classify a batch of contacts in a single request
    pub fn classify_batch(&self, contacts: &[ContactForVerification]) -> Result<(Vec<VerificationResult>, String), String> {
        let request = ChatRequest {
            model: self.config.model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: Self::build_batch_prompt(contacts),
            }],
            temperature: 0.1,
            max_tokens: 200,
        };

        let url = self.config.api_url();

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .json(&request)
            .send()
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let chat_response: ChatResponse = response
            .json()
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        if let Some(error) = chat_response.error {
            return Err(format!("API error: {}", error.message));
        }

        let raw_response = chat_response
            .choices
            .and_then(|c| c.into_iter().next())
            .map(|c| c.message.content)
            .unwrap_or_default();

        let classifications = Self::parse_batch_response(&raw_response, contacts.len());

        let results: Vec<VerificationResult> = contacts
            .iter()
            .zip(classifications.iter())
            .map(|(contact, &classification)| VerificationResult {
                email: contact.email.clone(),
                name: contact.name.clone(),
                classification: classification.as_u8(),
                raw_response: raw_response.clone(),
            })
            .collect();

        Ok((results, raw_response))
    }

    /// Classify all contacts in batches
    pub fn classify_all(
        &self,
        contacts: &[ContactForVerification],
        batch_size: usize,
        progress_callback: impl Fn(usize, usize, usize),
    ) -> Vec<Result<VerificationResult, String>> {
        let mut all_results = Vec::with_capacity(contacts.len());
        let total_batches = (contacts.len() + batch_size - 1) / batch_size;

        for (batch_idx, chunk) in contacts.chunks(batch_size).enumerate() {
            progress_callback(batch_idx + 1, total_batches, chunk.len());

            match self.classify_batch(chunk) {
                Ok((results, _raw)) => {
                    for r in results {
                        all_results.push(Ok(r));
                    }
                }
                Err(e) => {
                    for contact in chunk {
                        all_results.push(Err(format!(
                            "Batch error for {}: {}",
                            contact.email, e
                        )));
                    }
                }
            }
        }

        all_results
    }
}
