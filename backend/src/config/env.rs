use anyhow::{Context, Result, bail};

/// Validated environment configuration.
#[derive(Debug, Clone)]
pub struct EnvConfig {
    /// Discord bot token.
    pub bot_token: String,
    /// PostgreSQL connection URL.
    pub pg_url: String,
    /// Sentry DSN for error tracking.
    pub sentry_dsn: String,
    /// OpenAI API key.
    pub openai_api_key: String,
    /// Shared secret for REST API authentication (min 32 chars).
    pub api_secret: String,
    /// Port for the REST API server.
    pub api_port: u16,
    /// Dashboard origin for CORS.
    pub dashboard_origin: String,
}

impl EnvConfig {
    /// Loads and validates environment variables.
    pub fn load() -> Result<Self> {
        let bot_token = required_env("BOT_TOKEN")?;
        let pg_url = required_env("PG_URL")?;
        let sentry_dsn = required_env("SENTRY_DSN")?;
        let openai_api_key = required_env("OPENAI_API_KEY")?;
        let api_secret = required_env("API_SECRET")?;

        if api_secret.len() < 32 {
            bail!("API_SECRET must be at least 32 characters");
        }

        // Validate PG_URL format.
        if !pg_url.starts_with("postgres://") && !pg_url.starts_with("postgresql://") {
            bail!("PG_URL must be a valid PostgreSQL connection URL");
        }

        let api_port: u16 = std::env::var("API_PORT")
            .unwrap_or_else(|_| "3000".to_string())
            .parse()
            .context("API_PORT must be a valid port number")?;

        let dashboard_origin = std::env::var("DASHBOARD_ORIGIN")
            .unwrap_or_else(|_| "http://localhost:5173".to_string());

        Ok(Self {
            bot_token,
            pg_url,
            sentry_dsn,
            openai_api_key,
            api_secret,
            api_port,
            dashboard_origin,
        })
    }
}

/// Retrieves a required environment variable, returning an error if it's missing or empty.
fn required_env(key: &str) -> Result<String> {
    let value = std::env::var(key).with_context(|| format!("Missing required env var: {key}"))?;
    if value.is_empty() {
        bail!("Environment variable {key} must not be empty");
    }
    Ok(value)
}
