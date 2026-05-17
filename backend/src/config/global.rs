use anyhow::{Context, Result, bail};
use serde::Deserialize;
use tracing::info;

/// Global configuration loaded from `cfg.global.yml`.
#[derive(Debug, Clone, Deserialize)]
pub struct GlobalConfig {
    /// Developer user IDs with elevated permissions.
    #[serde(default)]
    pub developers: Vec<String>,
    /// Database-related configuration.
    pub database: DatabaseConfig,
}

/// Database configuration section.
#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    /// Message retention settings.
    pub messages: MessageRetentionConfig,
    /// Report auto-disregard settings.
    pub reports: ReportConfig,
}

/// Message retention cron job configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct MessageRetentionConfig {
    /// Cron expression for message insertion (e.g., "0 * * * *").
    pub insert_cron: String,
    /// Cron expression for message deletion (e.g., "0 */6 * * *").
    pub delete_cron: String,
    /// Time-to-live for messages in milliseconds (default: 7 days).
    #[serde(default = "default_ttl")]
    pub ttl: u64,
}

/// Report auto-disregard cron configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct ReportConfig {
    /// Cron expression for auto-disregarding old reports.
    pub disregard_cron: String,
}

fn default_ttl() -> u64 {
    604_800_000 // 7 days in milliseconds
}

impl GlobalConfig {
    /// Loads the global configuration from a YAML file.
    pub fn load(path: &str) -> Result<Self> {
        if !std::path::Path::new(path).exists() {
            bail!("Global configuration file ({path}) is missing.");
        }

        let content =
            std::fs::read_to_string(path).with_context(|| format!("Failed to read {path}"))?;

        let config: GlobalConfig =
            serde_yaml::from_str(&content).with_context(|| format!("Failed to parse {path}"))?;

        info!("Successfully loaded global configuration from {path}.");
        Ok(config)
    }

    /// Checks if a user ID belongs to a developer.
    pub fn is_developer(&self, user_id: &str) -> bool {
        self.developers.iter().any(|id| id == user_id)
    }
}
