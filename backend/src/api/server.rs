use std::sync::Arc;

use axum::Router;
use axum::middleware;
use axum::http::HeaderValue;
use poise::serenity_prelude as serenity;
use tower_http::cors::CorsLayer;
use tracing::{info, warn};

use crate::AppState;

use super::auth::{self, ApiState};
use super::routes;

/// Starts the REST API server alongside the Discord gateway.
pub async fn start(
    state: Arc<AppState>,
    ctx: serenity::Context,
) -> std::io::Result<()> {
    let port = state.env.api_port;
    let dashboard_origin = state.env.dashboard_origin.clone();

    let api_state = ApiState {
        app: state.clone(),
        discord_http: ctx.http.clone(),
        cache: ctx.cache.clone(),
    };

    let dashboard_origin_header = dashboard_origin
        .parse::<HeaderValue>()
        .unwrap_or_else(|err| {
            warn!(
                "Invalid DASHBOARD_ORIGIN '{}': {err}. Falling back to http://localhost:5173.",
                dashboard_origin
            );
            HeaderValue::from_static("http://localhost:5173")
        });

    // CORS configuration matching the original Fastify setup.
    let cors = CorsLayer::new()
        .allow_origin(dashboard_origin_header)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-guild-id"),
            axum::http::HeaderName::from_static("x-user-id"),
        ])
        .max_age(std::time::Duration::from_secs(86400));

    // Build the router with file-based route structure.
    let app = Router::new()
        .merge(routes::health::router())
        .nest("/guilds", routes::guilds::router())
        .nest("/developers", routes::developers::router())
        .layer(middleware::from_fn_with_state(
            api_state.clone(),
            auth::auth_middleware,
        ))
        .layer(cors)
        .with_state(api_state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    info!("REST API server listening on {addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
