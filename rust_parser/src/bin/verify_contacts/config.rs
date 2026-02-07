use serde::{Deserialize, Serialize};

/// Configuration for Hugging Face Inference API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HFConfig {
    /// API key for Hugging Face
    pub api_key: String,

    /// Model ID (e.g., "meta-llama/Llama-3.2-1B")
    pub model: String,

    /// Request timeout in seconds
    pub timeout_secs: u64,

    /// Number of contacts per batch
    pub batch_size: usize,
}

impl HFConfig {
    /// Create config from environment variables
    pub fn from_env() -> Result<Self, String> {
        let api_key = std::env::var("HF_API_KEY")
            .map_err(|_| "HF_API_KEY environment variable not set")?;

        let model = std::env::var("HF_MODEL")
            .unwrap_or_else(|_| "moonshotai/Kimi-K2.5".to_string());

        let timeout_secs = std::env::var("HF_TIMEOUT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(120);

        // Llama 3 70B: 8K context, ~20 tokens per contact input, ~2 tokens output
        // Safe max: (8000 - 500 overhead) / 22 ≈ 340, use 250 for safety margin
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

    /// Get full API URL
    pub fn api_url(&self) -> String {
        "https://router.huggingface.co/v1/chat/completions".to_string()
    }
}

/// Classification result for a contact
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum ContactClassification {
    /// 0 - Not a human (automated/spam)
    NotHuman = 0,
    /// 1 - Human
    Human = 1,
    /// 2 - Unclear/Unknown
    Unknown = 2,
}

impl ContactClassification {
    pub fn from_str(s: &str) -> Self {
        for ch in s.chars() {
            match ch {
                '0' => return Self::NotHuman,
                '1' => return Self::Human,
                '2' => return Self::Unknown,
                _ => continue,
            }
        }
        Self::Unknown
    }

    pub fn as_u8(&self) -> u8 {
        *self as u8
    }
}

/// Contact data for verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactForVerification {
    pub name: String,
    pub email: String,
    pub received: u32,
    pub sent: u32,
}

/// Verification result for a single contact
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub email: String,
    pub name: String,
    pub classification: u8,
    pub raw_response: String,
}

/// Full verification output
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationOutput {
    pub config: HFConfigSummary,
    pub total_contacts: usize,
    pub processed: usize,
    pub results: Vec<VerificationResult>,
    pub stats: VerificationStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HFConfigSummary {
    pub model: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VerificationStats {
    pub not_human: usize,
    pub human: usize,
    pub unknown: usize,
    pub errors: usize,
}
