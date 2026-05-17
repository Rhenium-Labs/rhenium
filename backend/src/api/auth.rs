use std::sync::Arc;

use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use subtle::ConstantTimeEq;

use crate::AppState;

/// Shared API state accessible from route handlers.
#[derive(Clone)]
pub struct ApiState {
    pub app: Arc<AppState>,
    pub discord_http: std::sync::Arc<poise::serenity_prelude::Http>,
    pub cache: std::sync::Arc<poise::serenity_prelude::Cache>,
}

/// Authentication middleware that verifies the shared secret.
///
/// Uses constant-time comparison to prevent timing attacks.
pub async fn auth_middleware(
    headers: HeaderMap,
    axum::extract::State(state): axum::extract::State<ApiState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = auth_header.strip_prefix("Bearer ").unwrap_or("");
    let secret = state.app.env.api_secret.as_bytes();
    let token_bytes = token.as_bytes();

    // Constant-time comparison.
    if secret.len() != token_bytes.len() || !bool::from(secret.ct_eq(token_bytes)) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}
