pub mod roles;
pub mod channels;
pub mod members;
pub mod config;
pub mod webhooks;

use axum::Router;

use crate::api::auth::ApiState;

/// Aggregates all `/guilds/...` sub-routes.
pub fn router() -> Router<ApiState> {
    Router::new()
        .merge(roles::router())
        .merge(channels::router())
        .merge(members::router())
        .merge(config::router())
        .merge(webhooks::router())
}
