use poise::serenity_prelude as serenity;
use sea_orm::{EntityTrait, Set};
use tracing::error;

use crate::Data;

/// Handles the GuildAuditLogEntryCreate event.
///
/// - Removes deleted logging webhooks from guild config.
pub async fn handle(
    ctx: &serenity::Context,
    entry: &serenity::AuditLogEntry,
    guild_id: &serenity::GuildId,
    data: &Data,
) {
    use serenity::model::guild::audit_log::{Action, WebhookAction};

    let bot_id = ctx.cache.current_user().id;
    if entry.user_id == bot_id {
        return;
    }

    if !matches!(entry.action, Action::Webhook(WebhookAction::Delete)) {
        return;
    }

    let Some(target_id) = entry.target_id else {
        return;
    };
    let target_webhook_id = target_id.get().to_string();

    let config = data.config_manager.get_guild_config(&data.db, *guild_id).await;
    if !config
        .data
        .logging_webhooks
        .iter()
        .any(|wh| wh.id == target_webhook_id)
    {
        return;
    }

    let mut updated = config.data.clone();
    updated
        .logging_webhooks
        .retain(|wh| wh.id != target_webhook_id);

    let config_json = match serde_json::to_value(&updated) {
        Ok(json) => json,
        Err(e) => {
            error!(
                "Failed to serialize updated guild config for webhook cleanup in {}: {e}",
                guild_id
            );
            return;
        }
    };

    let active = crate::lib::entities::guild::ActiveModel {
        id: Set(guild_id.to_string()),
        config: Set(config_json),
    };
    if let Err(e) = crate::lib::entities::guild::Entity::update(active).exec(&data.db).await {
        error!(
            "Failed to persist webhook cleanup for guild {} and webhook {}: {e}",
            guild_id, target_webhook_id
        );
        return;
    }

    data.config_manager.invalidate(guild_id);
}
