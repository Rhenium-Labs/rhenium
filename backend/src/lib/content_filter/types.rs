//! Content filter type definitions.

use std::collections::{HashMap, HashSet};

use sea_orm::entity::prelude::*;

/// Detector types used by the content filter.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    serde::Serialize,
    serde::Deserialize,
    EnumIter,
    DeriveActiveEnum,
)]
#[sea_orm(rs_type = "String", db_type = "Enum", enum_name = "Detector")]
#[allow(clippy::upper_case_acronyms)]
pub enum Detector {
    #[sea_orm(string_value = "NSFW")]
    NSFW,
    #[sea_orm(string_value = "OCR")]
    OCR,
    #[sea_orm(string_value = "TEXT")]
    TEXT,
}

impl std::fmt::Display for Detector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Detector::NSFW => write!(f, "NSFW"),
            Detector::OCR => write!(f, "OCR"),
            Detector::TEXT => write!(f, "TEXT"),
        }
    }
}

/// Content filter alert status.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    serde::Serialize,
    serde::Deserialize,
    EnumIter,
    DeriveActiveEnum,
)]
#[sea_orm(rs_type = "String", db_type = "Enum", enum_name = "ContentFilterStatus")]
pub enum ContentFilterStatus {
    #[sea_orm(string_value = "Pending")]
    Pending,
    #[sea_orm(string_value = "Resolved")]
    Resolved,
    #[sea_orm(string_value = "False")]
    False,
    #[sea_orm(string_value = "Deleted")]
    Deleted,
}

impl std::fmt::Display for ContentFilterStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContentFilterStatus::Pending => write!(f, "Pending"),
            ContentFilterStatus::Resolved => write!(f, "Resolved"),
            ContentFilterStatus::False => write!(f, "False"),
            ContentFilterStatus::Deleted => write!(f, "Deleted"),
        }
    }
}

/// Source of a scan job.
/// Matches TS `ScanJobSource = "automated" | "heuristic"`.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScanSource {
    Heuristic,
    Automated,
}

impl std::fmt::Display for ScanSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScanSource::Heuristic => write!(f, "heuristic"),
            ScanSource::Automated => write!(f, "automated"),
        }
    }
}

/// A scan job in the queue.
#[derive(Debug, Clone)]
pub struct ScanJob {
    pub job_id: String,
    pub dedupe_key: String,
    pub message_id: String,
    pub channel_id: String,
    pub guild_id: String,
    pub author_id: String,
    pub source: ScanSource,
    pub attempts: u32,
    pub max_attempts: u32,
    pub enqueued_at: u64,
    pub next_run_at: u64,
    pub risk: f64,
    pub is_retry: bool,
    pub heuristic_signals: Vec<String>,
    pub force: bool,
}

impl PartialEq for ScanJob {
    fn eq(&self, other: &Self) -> bool {
        self.job_id == other.job_id
    }
}

impl Eq for ScanJob {}

impl PartialOrd for ScanJob {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ScanJob {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        if self.force != other.force {
            return self.force.cmp(&other.force);
        }

        if self.next_run_at != other.next_run_at {
            return other.next_run_at.cmp(&self.next_run_at);
        }

        let risk_cmp = self
            .risk
            .partial_cmp(&other.risk)
            .unwrap_or(std::cmp::Ordering::Equal);
        if risk_cmp != std::cmp::Ordering::Equal {
            return risk_cmp;
        }

        other.enqueued_at.cmp(&self.enqueued_at)
    }
}

/// Per-channel scan state for heuristic rate control.
#[derive(Debug, Clone)]
pub struct ChannelScanState {
    pub channel_id: String,
    pub guild_id: Option<String>,
    /// Timestamps of recent scans.
    pub scan_timestamps: Vec<u64>,
    /// Number of alerts generated since last rate adjustment.
    pub alert_count: u32,
    /// Current scan rate (scans/minute).
    pub scan_rate: f64,
    /// False positive ratio (0.0 - 1.0).
    pub false_positive_ratio: f64,
    /// Exponentially weighted moving average of messages per minute.
    pub ewma_mpm: f64,
    /// Logged EWMA rate (smoothed for display).
    pub logged_rate_ewma: f64,
    /// Recent message timestamps for EWMA calculation.
    pub message_timestamps: Vec<u64>,
    /// Beta distribution alpha parameter (false-positive confidence).
    pub beta_a: f64,
    /// Beta distribution beta parameter (true-positive confidence).
    pub beta_b: f64,
    /// Timestamp of last beta decay calculation.
    pub beta_last_update: u64,
    /// Map of user_id -> list of alert timestamps.
    pub flagged_users: HashMap<String, Vec<u64>>,
    /// Timestamp of last scan rate increase.
    pub last_rate_increase: u64,
    /// Set of users who have been priority-alerted.
    pub priority_alerted_users: HashSet<String>,
    /// User suspicion scores.
    pub user_scores: HashMap<String, UserScoreEntry>,
    /// Last activity timestamp.
    pub last_activity: u64,
    /// Last time the rate was logged.
    pub last_rate_log: u64,
}

/// User score entry for content filter state.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UserScoreEntry {
    pub score: f64,
    pub last_scan: u64,
}

impl ChannelScanState {
    pub fn new(channel_id: String, guild_id: Option<String>) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let base_rate = crate::utils::constants::cf::HEURISTIC_BASE_SCAN_RATE as f64;
        Self {
            channel_id,
            guild_id,
            scan_timestamps: Vec::new(),
            alert_count: 0,
            scan_rate: base_rate,
            false_positive_ratio: 0.0,
            ewma_mpm: base_rate,
            logged_rate_ewma: base_rate,
            message_timestamps: Vec::new(),
            beta_a: 1.0,
            beta_b: 1.0,
            beta_last_update: now,
            flagged_users: HashMap::new(),
            last_rate_increase: 0,
            priority_alerted_users: HashSet::new(),
            user_scores: HashMap::new(),
            last_activity: now,
            last_rate_log: 0,
        }
    }
}

/// A single prediction data point from a detector.
#[derive(Debug, Clone)]
pub struct ContentPredictionData {
    pub content: String,
    pub score: Option<String>,
    pub category: Option<String>,
}

/// Results from running a specific detector on a message.
#[derive(Debug, Clone)]
pub struct ContentPredictions {
    pub data: Vec<ContentPredictionData>,
    pub detector: Option<Detector>,
    pub content: Vec<String>,
}

/// Dead letter entry for failed scans.
/// Serialized as camelCase to match the TS `DeadLetterEntry` shape stored in KV.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadLetterEntry {
    pub id: String,
    pub created_at: u64,
    pub reason: String,
    pub job: DeadLetterJob,
    pub error: Option<String>,
}

/// Dead letter job data.
/// Serialized as camelCase to match the TS `ScanJob` pick shape stored in KV.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadLetterJob {
    pub job_id: String,
    pub message_id: String,
    pub source: String,
    pub guild_id: String,
    pub channel_id: String,
    pub author_id: String,
    pub attempts: u32,
    pub max_attempts: u32,
    pub risk: f64,
}

/// Diagnostics for a scan job queue.
#[derive(Debug, Clone)]
pub struct QueueDiagnostics {
    pub total: usize,
    pub new_jobs: usize,
    pub retry_jobs: usize,
    pub next_scheduled_at: Option<u64>,
    pub oldest_enqueued_at: Option<u64>,
}

/// Diagnostics for dead letters.
#[derive(Debug, Clone)]
pub struct DeadLetterDiagnostics {
    pub total_recorded: usize,
    pub buffered: usize,
}

/// Pre-alert action results.
#[derive(Debug, Clone)]
pub struct PreAlertActionsResult {
    pub flags: Vec<String>,
    pub disable_delete_button: bool,
    pub deleted_before_alert: bool,
}
