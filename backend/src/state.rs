//! Shared application state and core type aliases.

use std::sync::{Arc, OnceLock};
use std::time::Instant;

use sea_orm::DatabaseConnection;

use crate::lib::config::env::EnvConfig;
use crate::lib::config::global::GlobalConfig;
use crate::lib::config::manager::ConfigManager;
use crate::lib::repository::messages::MessageManager;
use crate::lib::kv::KvStore;

/// Shared application state accessible from all commands, events, and components.
pub struct AppState {
    /// SeaORM PostgreSQL connection pool.
    pub db: DatabaseConnection,
    /// Per-guild configuration cache.
    pub config_manager: ConfigManager,
    /// Global bot configuration (loaded from `cfg.global.yml`).
    pub global_config: GlobalConfig,
    /// Environment variables (tokens, DSNs, ports).
    pub env: EnvConfig,
    /// In-memory message buffer and DB writer.
    pub message_manager: MessageManager,
    /// LMDB key-value store for fast local caching.
    pub kv: KvStore,
    /// Shared HTTP client for external requests.
    pub http_client: reqwest::Client,
}

/// Poise user data type — the Arc-wrapped shared state.
pub type Data = Arc<AppState>;

/// Poise error type — boxed for compatibility with the framework.
pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// Poise context type alias used in command handlers.
pub type Context<'a> = poise::Context<'a, Data, Error>;

static PROCESS_STARTED_AT: OnceLock<Instant> = OnceLock::new();

/// Record the process start time. Call once at the beginning of `main`.
pub fn init_uptime() {
    let _ = PROCESS_STARTED_AT.set(Instant::now());
}

/// Returns milliseconds elapsed since the process started.
pub fn process_uptime_ms() -> u64 {
    PROCESS_STARTED_AT
        .get()
        .map(|start| start.elapsed().as_millis() as u64)
        .unwrap_or(0)
}
