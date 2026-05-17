use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Json, Router, routing::get};
use poise::serenity_prelude::{GuildId, RoleId};
use serde::Serialize;

use crate::api::auth::ApiState;

/// Role info returned by the API.
#[derive(Debug, Serialize)]
pub struct RoleInfo {
    pub id: String,
    pub name: String,
    pub color: u32,
    pub position: u16,
    pub managed: bool,
}

/// GET /guilds/:id/roles
async fn get_roles(
    State(state): State<ApiState>,
    Path(guild_id): Path<String>,
) -> Result<Json<Vec<RoleInfo>>, StatusCode> {
    let gid: u64 = guild_id.parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    let guild_id = GuildId::new(gid);
    let everyone_role_id = RoleId::new(gid); // @everyone role ID == guild ID

    let guild = state.cache.guild(guild_id);
    let guild = match guild {
        Some(g) => g,
        None => return Ok(Json(vec![])),
    };

    let mut roles: Vec<RoleInfo> = guild
        .roles
        .values()
        .filter(|role| role.id != everyone_role_id)
        .map(|role| RoleInfo {
            id: role.id.to_string(),
            name: role.name.clone(),
            color: role.colour.0,
            position: role.position,
            managed: role.managed,
        })
        .collect();

    // Sort by position descending (highest roles first).
    roles.sort_by(|a, b| b.position.cmp(&a.position));

    Ok(Json(roles))
}

pub fn router() -> Router<ApiState> {
    Router::new().route("/{id}/roles", get(get_roles))
}
