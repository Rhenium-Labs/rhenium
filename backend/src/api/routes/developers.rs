use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::{Json, Router, routing::get};
use serde::Serialize;

use crate::api::auth::ApiState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperVerifyResult {
    pub is_developer: bool,
}

/// GET /developers/:user_id/verify
async fn verify_developer(
    State(state): State<ApiState>,
    Path(user_id): Path<String>,
) -> Result<Json<DeveloperVerifyResult>, StatusCode> {
    let is_developer = state.app.global_config.is_developer(&user_id);
    Ok(Json(DeveloperVerifyResult { is_developer }))
}

pub fn router() -> Router<ApiState> {
    Router::new().route("/{user_id}/verify", get(verify_developer))
}
