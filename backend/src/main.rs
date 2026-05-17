mod api;
mod commands;
mod components;
mod config;
mod content_filter;
mod cron;
mod database;
mod entities;
mod events;
mod kv;
mod state;
mod utils;

pub use state::{AppState, Context, Data, Error, init_uptime, process_uptime_ms};

use std::sync::Arc;
use std::time::Duration;

use anyhow::Context as _;
use poise::serenity_prelude as serenity;
use sea_orm::ConnectOptions;
use tracing::{error, info};

use crate::config::env::EnvConfig;
use crate::config::global::GlobalConfig;
use crate::config::manager::ConfigManager;
use crate::database::messages::MessageManager;
use crate::kv::KvStore;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_uptime();

    // Load .env file (silently ignore if missing — Docker uses real env vars).
    let _ = dotenvy::dotenv();

    // Initialize tracing/logging.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rhenium=info,serenity=warn".into()),
        )
        .with_target(false)
        .init();

    // Validate and load environment variables.
    let env = EnvConfig::load().context("Failed to load environment configuration")?;

    // Initialize Sentry for error tracking.
    let _sentry_guard = sentry::init((
        env.sentry_dsn.clone(),
        sentry::ClientOptions {
            release: sentry::release_name!(),
            traces_sample_rate: 1.0,
            ..Default::default()
        },
    ));

    info!("Starting Rhenium...");

    // Load global configuration from YAML.
    let global_config =
        GlobalConfig::load("cfg.global.yml").context("Failed to load global configuration")?;
    info!("Loaded global configuration.");

    // Connect to the database.
    let db = sea_orm::Database::connect(build_database_options(&env.pg_url))
        .await
        .context("Failed to connect to the database")?;
    info!("Connected to the database.");

    // Initialize LMDB key-value store.
    let kv = KvStore::open(".cache/kv").context("Failed to open KV store")?;
    info!("Opened KV store.");

    // Build shared application state.
    let state = Arc::new(AppState {
        db: db.clone(),
        config_manager: ConfigManager::new(),
        global_config,
        env: env.clone(),
        message_manager: MessageManager::new(),
        kv,
        http_client: build_http_client()?,
    });

    // Define gateway intents.
    let intents = serenity::GatewayIntents::GUILDS
        | serenity::GatewayIntents::GUILD_MEMBERS
        | serenity::GatewayIntents::GUILD_MESSAGES
        | serenity::GatewayIntents::MESSAGE_CONTENT
        | serenity::GatewayIntents::GUILD_MESSAGE_REACTIONS
        | serenity::GatewayIntents::GUILD_EMOJIS_AND_STICKERS
        | serenity::GatewayIntents::GUILD_MODERATION;

    // Build the poise framework.
    let framework_state = state.clone();
    let default_allowed_mentions = serenity::CreateAllowedMentions::new()
        .all_users(false)
        .all_roles(false)
        .everyone(false)
        .replied_user(false);

    let framework = poise::Framework::builder()
        .options(poise::FrameworkOptions {
            commands: commands::all_commands(),
            allowed_mentions: Some(default_allowed_mentions.clone()),
            prefix_options: poise::PrefixFrameworkOptions {
                prefix: Some(".".into()),
                ..Default::default()
            },
            event_handler: |ctx, event, framework, data| {
                Box::pin(events::handle_event(ctx, event, framework, data))
            },
            on_error: |error| {
                Box::pin(async move {
                    if let Err(e) = utils::error::on_error(error).await {
                        error!("Fatal error in error handler: {e:?}");
                    }
                })
            },
            ..Default::default()
        })
        .setup(move |ctx, ready, framework| {
            let state = framework_state.clone();
            Box::pin(async move {
                info!("Logged in as {}", ready.user.name);

                // Register application commands.
                poise::builtins::register_globally(ctx, &framework.options().commands).await?;
                info!("Registered application commands.");

                // Start the REST API server.
                let api_state = state.clone();
                let api_ctx = ctx.clone();
                tokio::spawn(async move {
                    if let Err(e) = api::server::start(api_state, api_ctx).await {
                        error!("REST API server failed: {e:?}");
                    }
                });

                Ok(state)
            })
        })
        .build();

    let http = serenity::HttpBuilder::new(&env.bot_token)
        .default_allowed_mentions(default_allowed_mentions)
        .build();

    // Build the serenity client.
    let mut client = serenity::ClientBuilder::new_with_http(http, intents)
        .framework(framework)
        .await
        .context("Failed to create Discord client")?;

    // Set up graceful shutdown.
    let shard_manager = client.shard_manager.clone();
    let shutdown_state = state.clone();

    tokio::spawn(async move {
        if let Err(err) = tokio::signal::ctrl_c().await {
            error!("Failed to listen for Ctrl+C: {err}");
            return;
        }

        info!("Received shutdown signal, flushing message buffer...");

        shutdown_state
            .message_manager
            .insert(&shutdown_state.db, Some("SIGINT"))
            .await;

        shard_manager.shutdown_all().await;
    });

    // Start the bot.
    client.start().await.context("Client error")?;

    Ok(())
}

fn build_http_client() -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("rhenium/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .build()
        .context("Failed to build HTTP client")
}

fn build_database_options(pg_url: &str) -> ConnectOptions {
    let mut options = ConnectOptions::new(pg_url.to_string());
    options
        .max_connections(20)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(60))
        .acquire_timeout(Duration::from_secs(60))
        .idle_timeout(Duration::from_secs(300))
        .sqlx_logging(false);
    options
}
