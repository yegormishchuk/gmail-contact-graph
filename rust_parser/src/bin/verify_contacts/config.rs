use serde::{Deserialize, Serialize};

// Re-export shared types for convenience
pub use fast_mbox_parser::hf::{HFConfig, VerificationResult};

/// Full verification output (verify_contacts specific)
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
