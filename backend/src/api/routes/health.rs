use axum::{Router, routing::get};

use crate::api::auth::ApiState;

/// GET /health
async fn health_check() -> &'static str {
    "ok"
}

pub fn router() -> Router<ApiState> {
    Router::new().route("/health", get(health_check))
}
