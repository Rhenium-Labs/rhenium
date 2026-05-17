use axum::extract::{Path, State};
use axum::{Json, Router, routing::get};
use poise::serenity_prelude::{GuildId, UserId};
use serde::Serialize;

use crate::api::auth::ApiState;
use crate::error::ApiError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub is_member: bool,
}

/// GET /guilds/:guild_id/members/:user_id/verify
async fn verify_member(
    State(state): State<ApiState>,
    Path((guild_id, user_id)): Path<(String, String)>,
) -> Result<Json<VerifyResult>, ApiError> {
    let gid: u64 = guild_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid guild ID".into()))?;
    let uid: u64 = user_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid user ID".into()))?;

    // Check if user is a developer (developers have access to all guilds).
    if state.app.global_config.is_developer(&user_id) {
        return Ok(Json(VerifyResult { is_member: true }));
    }

    let guild_id = GuildId::new(gid);
    let user_id = UserId::new(uid);

    // Check the in-memory cache first; fall back to a REST call (mirrors TS guild.members.fetch).
    let in_cache = state
        .cache
        .guild(guild_id)
        .map(|g| g.members.contains_key(&user_id))
        .unwrap_or(false);
    let is_member = if in_cache {
        true
    } else {
        state.discord_http.get_member(guild_id, user_id).await.is_ok()
    };

    Ok(Json(VerifyResult { is_member }))
}

pub fn router() -> Router<ApiState> {
    Router::new().route("/{guild_id}/members/{user_id}/verify", get(verify_member))
}
