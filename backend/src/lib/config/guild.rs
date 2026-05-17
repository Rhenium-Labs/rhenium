use poise::serenity_prelude::{self as serenity, GuildId, Member};
use tracing::{error, warn};

use super::schema::{
    ContentFilterConfig, LoggingEvent, LoggingWebhook, RawGuildConfig, UserPermission,
};

/// A guild configuration instance with logging capabilities.
#[derive(Debug, Clone)]
pub struct GuildConfig {
    /// The guild ID this config belongs to.
    pub id: GuildId,
    /// The raw configuration data.
    pub data: RawGuildConfig,
}

/// Parsed content filter configuration (with webhook_url guaranteed non-null).
pub struct ParsedContentFilterConfig {
    pub config: ContentFilterConfig,
    pub webhook_url: String,
}

impl GuildConfig {
    /// Creates a new GuildConfig instance.
    pub fn new(id: GuildId, data: RawGuildConfig) -> Self {
        Self { id, data }
    }

    // ──────────────────────────────────────────
    // Feature config parsers
    // ──────────────────────────────────────────

    /// Parse the message reports configuration.
    /// Returns `None` if reports are disabled or no webhook URL is set.
    pub fn parse_reports_config(&self) -> Option<&super::schema::MessageReportConfig> {
        let cfg = &self.data.message_reports;
        if !cfg.enabled || cfg.webhook_url.is_none() {
            return None;
        }
        Some(cfg)
    }

    /// Parse the ban requests configuration.
    /// Returns `None` if requests are disabled or no webhook URL is set.
    pub fn parse_ban_requests_config(&self) -> Option<&super::schema::BanRequestConfig> {
        let cfg = &self.data.ban_requests;
        if !cfg.enabled || cfg.webhook_url.is_none() {
            return None;
        }
        Some(cfg)
    }

    /// Parse a quick action configuration (quick mutes or quick purges).
    /// Returns `None` if the feature is disabled or required logging events can't be sent.
    pub fn parse_quick_mutes_config(&self) -> Option<&super::schema::QuickMuteConfig> {
        let cfg = &self.data.quick_mutes;
        if !cfg.enabled
            || !self.can_log_event(LoggingEvent::QuickMuteExecuted)
            || !self.can_log_event(LoggingEvent::QuickMuteResult)
        {
            return None;
        }
        Some(cfg)
    }

    /// Parse quick purges config.
    pub fn parse_quick_purges_config(&self) -> Option<&super::schema::QuickPurgeConfig> {
        let cfg = &self.data.quick_purges;
        if !cfg.enabled
            || !self.can_log_event(LoggingEvent::QuickPurgeExecuted)
            || !self.can_log_event(LoggingEvent::QuickPurgeResult)
        {
            return None;
        }
        Some(cfg)
    }

    /// Parse the content filter configuration.
    /// Returns `None` if the filter is disabled or no webhook URL is set.
    pub fn parse_content_filter_config(&self) -> Option<ParsedContentFilterConfig> {
        let cfg = &self.data.content_filter;
        let webhook_url = cfg.webhook_url.as_ref()?;
        if !cfg.enabled {
            return None;
        }
        Some(ParsedContentFilterConfig {
            config: cfg.clone(),
            webhook_url: webhook_url.clone(),
        })
    }

    // ──────────────────────────────────────────
    // Permissions
    // ──────────────────────────────────────────

    /// Check if a member has a specific permission scope.
    pub fn has_permission(&self, member: &Member, permission: UserPermission) -> bool {
        for scope in &self.data.permission_scopes {
            let role_id: serenity::RoleId = match scope.role_id.parse() {
                Ok(id) => serenity::RoleId::new(id),
                Err(_) => continue,
            };

            if member.roles.contains(&role_id) && scope.allowed_permissions.contains(&permission) {
                return true;
            }
        }
        false
    }

    // ──────────────────────────────────────────
    // Logging
    // ──────────────────────────────────────────

    /// Check if a logging event can be sent (i.e., at least one webhook is configured for it).
    pub fn can_log_event(&self, event: LoggingEvent) -> bool {
        self.data
            .logging_webhooks
            .iter()
            .any(|wh| wh.events.contains(&event))
    }

    /// Send a log message to all webhooks configured for a specific event.
    /// Returns the number of successfully sent messages.
    pub async fn log(
        &self,
        http: &serenity::Http,
        event: LoggingEvent,
        payload: serenity::ExecuteWebhook,
    ) -> u32 {
        self.log_with_files(http, event, payload, vec![]).await
    }

    /// Like [`log`], but also uploads file attachments alongside the message.
    /// Pass files here instead of calling `add_file` on the payload builder —
    /// `execute_webhook` requires them in the `files` parameter to include them
    /// in the multipart body.
    pub async fn log_with_files(
        &self,
        http: &serenity::Http,
        event: LoggingEvent,
        payload: serenity::ExecuteWebhook,
        files: Vec<serenity::CreateAttachment>,
    ) -> u32 {
        let webhooks: Vec<&LoggingWebhook> = self
            .data
            .logging_webhooks
            .iter()
            .filter(|wh| wh.events.contains(&event))
            .collect();

        if webhooks.is_empty() {
            return 0;
        }

        let mut sent = 0u32;
        for wh in webhooks {
            // Parse the webhook ID and token from the stored URL so we can
            // execute directly without an extra GET /webhooks/{id}/{token} roundtrip,
            // matching how TS WebhookClient sends directly from the URL.
            let webhook_id: u64 = match wh.id.parse() {
                Ok(id) => id,
                Err(_) => {
                    warn!("Invalid webhook ID '{}' in guild {}", wh.id, self.id);
                    continue;
                }
            };

            let result = http
                .execute_webhook(
                    serenity::WebhookId::new(webhook_id),
                    None,
                    &wh.token,
                    false,
                    files.clone(),
                    &payload,
                )
                .await;

            match result {
                Ok(_) => {
                    sent += 1;
                }
                Err(e) => {
                    error!(
                        "Failed to send log for event {:?} in guild {}: {e}",
                        event, self.id
                    );
                }
            }
        }

        sent
    }
}
