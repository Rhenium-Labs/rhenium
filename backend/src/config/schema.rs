use serde::{Deserialize, Serialize};

// ──────────────────────────────────────────────
// ──────────────────────────────────────────────

/// Detector types for the content filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Detector {
    Nsfw,
    Ocr,
    Text,
}

impl std::fmt::Display for Detector {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Detector::Nsfw => write!(f, "NSFW"),
            Detector::Ocr => write!(f, "OCR"),
            Detector::Text => write!(f, "TEXT"),
        }
    }
}

/// User permission levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum UserPermission {
    ReviewMessageReports,
    ReviewBanRequests,
    UseHighlights,
    UseQuickMute,
    UseQuickPurge,
}

impl std::fmt::Display for UserPermission {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserPermission::ReviewMessageReports => write!(f, "ReviewMessageReports"),
            UserPermission::ReviewBanRequests => write!(f, "ReviewBanRequests"),
            UserPermission::UseHighlights => write!(f, "UseHighlights"),
            UserPermission::UseQuickMute => write!(f, "UseQuickMute"),
            UserPermission::UseQuickPurge => write!(f, "UseQuickPurge"),
        }
    }
}

/// Logging event types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LoggingEvent {
    MessageReportReviewed,
    BanRequestReviewed,
    BanRequestResult,
    QuickPurgeResult,
    QuickPurgeExecuted,
    QuickMuteResult,
    QuickMuteExecuted,
}

/// Channel scoping type (include or exclude).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelScopingType {
    /// Actions can only be used in these channels.
    Include = 0,
    /// Actions can only be used outside of these channels.
    Exclude = 1,
}

impl ChannelScopingType {
    fn from_i64(value: i64) -> Option<Self> {
        match value {
            0 => Some(Self::Include),
            1 => Some(Self::Exclude),
            _ => None,
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "Include" | "include" | "0" => Some(Self::Include),
            "Exclude" | "exclude" | "1" => Some(Self::Exclude),
            _ => None,
        }
    }

    fn as_i64(self) -> i64 {
        match self {
            Self::Include => 0,
            Self::Exclude => 1,
        }
    }
}

impl Serialize for ChannelScopingType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_i64(self.as_i64())
    }
}

impl<'de> Deserialize<'de> for ChannelScopingType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct ChannelScopingTypeVisitor;

        impl<'de> serde::de::Visitor<'de> for ChannelScopingTypeVisitor {
            type Value = ChannelScopingType;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a channel scoping type (0/1, Include/Exclude)")
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                ChannelScopingType::from_i64(value)
                    .ok_or_else(|| E::custom(format!("invalid channel scoping type: {value}")))
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                if value <= i64::MAX as u64 {
                    return self.visit_i64(value as i64);
                }
                Err(E::custom(format!("invalid channel scoping type: {value}")))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                ChannelScopingType::from_str(value)
                    .ok_or_else(|| E::custom(format!("invalid channel scoping type: {value}")))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                self.visit_str(&value)
            }
        }

        deserializer.deserialize_any(ChannelScopingTypeVisitor)
    }
}

/// Detector mode for content filter sensitivity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DetectorMode {
    Lenient,
    Medium,
    Strict,
}

/// Content filter verbosity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContentFilterVerbosity {
    Minimal,
    Medium,
    Verbose,
}

// ──────────────────────────────────────────────
// Config sub-structures
// ──────────────────────────────────────────────

/// A permission scope binding a role to a set of permissions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionScope {
    pub role_id: String,
    #[serde(default)]
    pub allowed_permissions: Vec<UserPermission>,
}

/// A logging webhook configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingWebhook {
    pub id: String,
    pub url: String,
    pub token: String,
    pub channel_id: String,
    #[serde(default)]
    pub events: Vec<LoggingEvent>,
}

/// A channel scoping entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawChannelScoping {
    pub channel_id: String,
    #[serde(rename = "type")]
    pub scoping_type: ChannelScopingType,
}

// ──────────────────────────────────────────────
// Feature configs
// ──────────────────────────────────────────────

/// Message report configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageReportConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub webhook_url: Option<String>,
    pub webhook_channel: Option<String>,

    #[serde(default = "default_zero_str")]
    pub auto_disregard_after: String,
    #[serde(default = "default_true")]
    pub delete_submission_on_handle: bool,

    #[serde(default)]
    pub immune_roles: Vec<String>,
    #[serde(default)]
    pub notify_roles: Vec<String>,
    #[serde(default)]
    pub blacklisted_users: Vec<String>,
    pub placeholder_reason: Option<String>,

    #[serde(default = "default_true")]
    pub enforce_member_in_guild: bool,
    #[serde(default = "default_true")]
    pub enforce_report_reason: bool,
}

/// Ban request configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BanRequestConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub webhook_url: Option<String>,
    pub webhook_channel: Option<String>,

    #[serde(default)]
    pub automatically_timeout: bool,
    #[serde(default = "default_true")]
    pub enforce_submission_reason: bool,
    #[serde(default = "default_true")]
    pub enforce_deny_reason: bool,

    #[serde(default)]
    pub immune_roles: Vec<String>,
    #[serde(default)]
    pub notify_roles: Vec<String>,

    #[serde(default = "default_true")]
    pub notify_target: bool,
    #[serde(default)]
    pub disable_reason_field: bool,
    pub additional_info: Option<String>,
    pub delete_message_seconds: Option<i64>,
}

/// Content filter detector action configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentFilterDetectorAction {
    #[serde(default)]
    pub delete_message: bool,
    #[serde(default)]
    pub timeout_user: bool,
    #[serde(default = "default_timeout_duration")]
    pub timeout_duration_ms: u64,
}

/// NSFW-specific detector action with extra field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NsfwDetectorAction {
    #[serde(flatten)]
    pub base: ContentFilterDetectorAction,
    #[serde(default)]
    pub apply_to_text_nsfw: bool,
}

/// All detector actions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentFilterDetectorActions {
    #[serde(rename = "NSFW")]
    pub nsfw: NsfwDetectorAction,
    #[serde(rename = "OCR")]
    pub ocr: ContentFilterDetectorAction,
    #[serde(rename = "TEXT")]
    pub text: ContentFilterDetectorAction,
}

impl Default for ContentFilterDetectorActions {
    fn default() -> Self {
        Self {
            nsfw: NsfwDetectorAction {
                base: ContentFilterDetectorAction {
                    delete_message: false,
                    timeout_user: false,
                    timeout_duration_ms: default_timeout_duration(),
                },
                apply_to_text_nsfw: false,
            },
            ocr: ContentFilterDetectorAction {
                delete_message: false,
                timeout_user: false,
                timeout_duration_ms: default_timeout_duration(),
            },
            text: ContentFilterDetectorAction {
                delete_message: false,
                timeout_user: false,
                timeout_duration_ms: default_timeout_duration(),
            },
        }
    }
}

/// Content filter configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentFilterConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub webhook_url: Option<String>,
    pub webhook_channel: Option<String>,
    #[serde(default)]
    pub use_native_automod: bool,
    #[serde(default = "default_true")]
    pub use_heuristic_scanner: bool,

    #[serde(default)]
    pub detectors: Vec<Detector>,
    #[serde(default = "default_detector_mode")]
    pub detector_mode: DetectorMode,
    #[serde(default = "default_verbosity")]
    pub verbosity: ContentFilterVerbosity,

    #[serde(default)]
    pub immune_roles: Vec<String>,
    #[serde(default)]
    pub notify_roles: Vec<String>,
    #[serde(default)]
    pub detector_actions: ContentFilterDetectorActions,

    #[serde(default)]
    pub channel_scoping: Vec<RawChannelScoping>,

    #[serde(default)]
    pub ocr_filter_keywords: Vec<String>,
    #[serde(default)]
    pub ocr_filter_regex: Vec<String>,
}

/// Highlight configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_max_patterns")]
    pub max_patterns: u32,
}

/// Quick mute configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickMuteConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_purge_limit")]
    pub purge_limit: u32,
    #[serde(default)]
    pub channel_scoping: Vec<RawChannelScoping>,
}

/// Quick purge configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickPurgeConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_purge_limit")]
    pub max_limit: u32,
    #[serde(default)]
    pub channel_scoping: Vec<RawChannelScoping>,
}

// ──────────────────────────────────────────────
// Root guild configuration
// ──────────────────────────────────────────────

/// The full guild configuration stored as JSON in the `Guild.config` column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawGuildConfig {
    pub message_reports: MessageReportConfig,
    pub ban_requests: BanRequestConfig,
    pub content_filter: ContentFilterConfig,
    pub highlights: HighlightConfig,
    pub quick_mutes: QuickMuteConfig,
    pub quick_purges: QuickPurgeConfig,
    #[serde(default)]
    pub logging_webhooks: Vec<LoggingWebhook>,
    #[serde(default)]
    pub permission_scopes: Vec<PermissionScope>,
}

impl Default for RawGuildConfig {
    fn default() -> Self {
        Self {
            message_reports: MessageReportConfig {
                enabled: true,
                webhook_url: None,
                webhook_channel: None,
                auto_disregard_after: "0".to_string(),
                delete_submission_on_handle: true,
                immune_roles: vec![],
                notify_roles: vec![],
                blacklisted_users: vec![],
                placeholder_reason: None,
                enforce_member_in_guild: true,
                enforce_report_reason: true,
            },
            ban_requests: BanRequestConfig {
                enabled: true,
                webhook_url: None,
                webhook_channel: None,
                automatically_timeout: false,
                enforce_submission_reason: true,
                enforce_deny_reason: true,
                immune_roles: vec![],
                notify_roles: vec![],
                notify_target: true,
                disable_reason_field: false,
                additional_info: None,
                delete_message_seconds: None,
            },
            content_filter: ContentFilterConfig {
                enabled: true,
                webhook_url: None,
                webhook_channel: None,
                use_native_automod: false,
                use_heuristic_scanner: true,
                detectors: vec![],
                detector_mode: DetectorMode::Medium,
                verbosity: ContentFilterVerbosity::Medium,
                immune_roles: vec![],
                notify_roles: vec![],
                detector_actions: ContentFilterDetectorActions::default(),
                channel_scoping: vec![],
                ocr_filter_keywords: vec![],
                ocr_filter_regex: vec![],
            },
            highlights: HighlightConfig {
                enabled: true,
                max_patterns: 15,
            },
            quick_mutes: QuickMuteConfig {
                enabled: true,
                purge_limit: 100,
                channel_scoping: vec![],
            },
            quick_purges: QuickPurgeConfig {
                enabled: true,
                max_limit: 100,
                channel_scoping: vec![],
            },
            logging_webhooks: vec![],
            permission_scopes: vec![],
        }
    }
}

// ──────────────────────────────────────────────
// Default value helpers for serde
// ──────────────────────────────────────────────

fn default_true() -> bool {
    true
}
fn default_zero_str() -> String {
    "0".to_string()
}
fn default_timeout_duration() -> u64 {
    600_000 // 10 minutes in ms
}
fn default_detector_mode() -> DetectorMode {
    DetectorMode::Medium
}
fn default_verbosity() -> ContentFilterVerbosity {
    ContentFilterVerbosity::Medium
}
fn default_max_patterns() -> u32 {
    15
}
fn default_purge_limit() -> u32 {
    100
}
