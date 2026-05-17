use axum::extract::{Path, State};
use axum::{Json, Router, routing::post};
use poise::serenity_prelude::GuildId;
use serde::Serialize;

use crate::api::auth::ApiState;
use crate::error::ApiError;

#[derive(Debug, Serialize)]
pub struct InvalidateResult {
    pub success: bool,
}

/// POST /guilds/:id/config/invalidate
///
/// Invalidates and reloads the cached guild configuration.
async fn invalidate_config(
    State(state): State<ApiState>,
    Path(guild_id): Path<String>,
) -> Result<Json<InvalidateResult>, ApiError> {
    let gid: u64 = guild_id
        .parse()
        .map_err(|_| ApiError::BadRequest("Invalid guild ID".into()))?;
    let guild_id = GuildId::new(gid);

    state
        .app
        .config_manager
        .reload(&state.app.db, guild_id)
        .await;

    Ok(Json(InvalidateResult { success: true }))
}

pub fn router() -> Router<ApiState> {
    Router::new().route("/{id}/config/invalidate", post(invalidate_config))
}
