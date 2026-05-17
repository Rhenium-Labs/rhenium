use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{
    Json, Router,
    routing::{delete, post},
};
use poise::serenity_prelude::{self as serenity, ChannelId, GuildId};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::api::auth::ApiState;
use crate::error::ApiError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWebhookRequest {
    pub channel_id: String,
    pub existing_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WebhookResponse {
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWebhookRequest {
    pub webhook_url: String,
}

/// Parses a Discord webhook URL into (id, token).
/// URL format: https://discord.com/api/webhooks/{id}/{token}
fn parse_webhook_url(url: &str) -> Option<(u64, String)> {
    let parts: Vec<&str> = url.rsplitn(3, '/').collect();
    if parts.len() < 2 {
        return None;
    }
    let token = parts[0].to_string();
    let id: u64 = parts[1].parse().ok()?;
    Some((id, token))
}

/// POST /guilds/:id/webhooks
///
/// Creates or moves a webhook in the specified channel.
/// Mirrors the TS implementation: if `existing_url` is provided, try to move the existing
/// webhook to the target channel first; fall back to creating a new one.
async fn create_webhook(
    State(state): State<ApiState>,
    Path(guild_id): Path<String>,
    Json(body): Json<CreateWebhookRequest>,
) -> Result<Json<WebhookResponse>, ApiError> {
    let cid: u64 = body
        .channel_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid channel ID".into()))?;
    let channel_id = ChannelId::new(cid);
    let gid: u64 = guild_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid guild ID".into()))?;
    let guild_id_snowflake = GuildId::new(gid);

    // Fetch current bot user for name/avatar (matching TS: client.user.username / displayAvatarURL).
    let bot_user = state
        .discord_http
        .get_current_user()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let bot_name = bot_user.name.clone();
    let bot_avatar_url = bot_user.avatar_url();

    // If an existing webhook URL is provided, try to move it.
    if let Some(existing_url) = &body.existing_url {
        if let Some((existing_id, existing_token)) = parse_webhook_url(existing_url) {
            let webhook_id = serenity::WebhookId::new(existing_id);
            // Try fetching the guild's webhooks to verify the webhook still exists.
            let guild_webhooks = state
                .discord_http
                .get_guild_webhooks(guild_id_snowflake)
                .await
                .unwrap_or_default();

            let existing_wh = guild_webhooks.iter().find(|wh| wh.id == webhook_id);

            if let Some(existing_wh) = existing_wh {
                // If it's already in the right channel, return as-is.
                if existing_wh.channel_id == Some(channel_id) {
                    let url = existing_wh
                        .url()
                        .map_err(|e| ApiError::Internal(e.to_string()))?;
                    return Ok(Json(WebhookResponse { url }));
                }

                // Move the webhook to the new channel.
                let mut edit_map = serde_json::json!({
                    "channel_id": channel_id.to_string(),
                    "name": bot_name,
                });
                if let Some(avatar) = &bot_avatar_url {
                    edit_map["avatar"] = serde_json::Value::String(avatar.clone());
                }

                let moved = state
                    .discord_http
                    .edit_webhook_with_token(webhook_id, &existing_token, &edit_map, None)
                    .await;

                if let Ok(moved_wh) = moved {
                    let url = moved_wh
                        .url()
                        .map_err(|e| ApiError::Internal(e.to_string()))?;
                    return Ok(Json(WebhookResponse { url }));
                }
                // Fall through to create a new webhook if move fails.
            }
        }
    }

    // Create a new webhook in the target channel with the bot's name and avatar.
    let mut create_map = serde_json::json!({
        "name": bot_name,
    });
    if let Some(avatar) = &bot_avatar_url {
        create_map["avatar"] = serde_json::Value::String(avatar.clone());
    }

    let webhook = state
        .discord_http
        .create_webhook(channel_id, &create_map, None)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let url = webhook
        .url()
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(WebhookResponse { url }))
}

/// DELETE /guilds/:id/webhooks
///
/// Deletes a webhook by URL. Mirrors the TS implementation: errors are logged and swallowed;
/// the caller always gets a success response (matching TS `return void` semantics).
async fn delete_webhook(
    State(state): State<ApiState>,
    Path(_guild_id): Path<String>,
    Json(body): Json<DeleteWebhookRequest>,
) -> StatusCode {
    let Some((id, token)) = parse_webhook_url(&body.webhook_url) else {
        // Malformed URL — nothing to delete, log and return success (matching TS behavior).
        warn!(
            "Webhook deletion skipped — could not parse URL: {}",
            body.webhook_url
        );
        return StatusCode::NO_CONTENT;
    };

    let webhook_id = serenity::WebhookId::new(id);

    if let Err(e) = state
        .discord_http
        .delete_webhook_with_token(webhook_id, &token, None)
        .await
    {
        // TS swallows deletion errors (logs a warning and continues).
        warn!("Webhook deletion failed for URL {}: {e}", body.webhook_url);
    }

    StatusCode::NO_CONTENT
}

pub fn router() -> Router<ApiState> {
    Router::new()
        .route("/{id}/webhooks", post(create_webhook))
        .route("/{id}/webhooks", delete(delete_webhook))
}
