use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

/// Errors that occur during configuration loading (env vars or YAML files).
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Missing required environment variable: {0}")]
    MissingEnvVar(String),
    #[error("Environment variable '{0}' must not be empty")]
    EmptyEnvVar(String),
    #[error("Configuration validation failed: {0}")]
    Validation(String),
    #[error("Configuration file not found: {0}")]
    FileMissing(String),
    #[error("Failed to read configuration file '{path}': {source}")]
    FileRead { path: String, source: std::io::Error },
    #[error("Failed to parse configuration file '{path}': {source}")]
    YamlParse { path: String, source: serde_yaml::Error },
}

/// Errors from the LMDB key-value store.
#[derive(Debug, thiserror::Error)]
pub enum KvError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("LMDB error: {0}")]
    Heed(#[from] heed::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Errors returned by REST API route handlers.
///
/// Implements [`IntoResponse`] so it can be used directly as an Axum error type.
/// All variants produce a JSON body `{ "error": "<message>" }`.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("Internal server error")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.as_str()),
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error"),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
