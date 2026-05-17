use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Json, Router, routing::get};
use poise::serenity_prelude::{ChannelType, GuildId};
use serde::Serialize;

use crate::api::auth::ApiState;

/// Channel info returned by the API.
#[derive(Debug, Serialize)]
pub struct ChannelInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub channel_type: u8,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    pub position: u16,
}

/// GET /guilds/:id/channels
async fn get_channels(
    State(state): State<ApiState>,
    Path(guild_id): Path<String>,
) -> Result<Json<Vec<ChannelInfo>>, StatusCode> {
    let gid: u64 = guild_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    let guild_id = GuildId::new(gid);

    let guild = state.cache.guild(guild_id);
    let guild = match guild {
        Some(g) => g,
        None => return Ok(Json(vec![])),
    };

    // Filter to useful channel types (matching the TS implementation).
    // Includes GuildMedia (type 16) to match discord.js GuildMedia / ChannelType.GuildMedia.
    // GuildMedia (type 16) is not a named variant in serenity 0.12 — use Unknown(16).
    let allowed_types = [
        ChannelType::Text,
        ChannelType::News,
        ChannelType::Forum,
        ChannelType::Unknown(16),
        ChannelType::Voice,
        ChannelType::Stage,
        ChannelType::Category,
    ];

    let mut channels: Vec<ChannelInfo> = guild
        .channels
        .values()
        .filter(|ch| allowed_types.contains(&ch.kind))
        .map(|ch| {
            let channel_type_num = match ch.kind {
                ChannelType::Text => 0,
                ChannelType::Voice => 2,
                ChannelType::Category => 4,
                ChannelType::News => 5,
                ChannelType::Stage => 13,
                ChannelType::Forum => 15,
                ChannelType::Unknown(16) => 16,
                _ => 0,
            };
            ChannelInfo {
                id: ch.id.to_string(),
                name: ch.name.clone(),
                channel_type: channel_type_num,
                parent_id: ch.parent_id.map(|id| id.to_string()),
                position: ch.position,
            }
        })
        .collect();

    channels.sort_by(|a, b| a.position.cmp(&b.position));

    Ok(Json(channels))
}

pub fn router() -> Router<ApiState> {
    Router::new().route("/{id}/channels", get(get_channels))
}
