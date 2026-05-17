use poise::serenity_prelude as serenity;
use std::time::Instant;
use tracing::info;
use crate::Data;

static CLIENT_READY_AT: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

pub fn client_uptime_ms() -> u64 {
    CLIENT_READY_AT
        .get()
        .map(|ready_at| ready_at.elapsed().as_millis() as u64)
        .unwrap_or(0)
}

/// Handles the Ready event.
pub async fn handle(
    ctx: &serenity::Context,
    data_about_bot: &serenity::Ready,
    data: &Data,
) {
    let _ = CLIENT_READY_AT.set(Instant::now());

    info!(
        "Ready! Logged in as {} ({})",
        data_about_bot.user.name, data_about_bot.user.id
    );
    info!(
        "Connected to {} guilds.",
        data_about_bot.guilds.len()
    );

    // 1) Load prioritized guilds
    // 2) Start automated scanner loop
    // 3) Start heuristic cleanup interval
    // 4) Start cron jobs
    // 5) Start report-message KV cleanup
    crate::content_filter::load_prioritized_guilds(&data.db).await;
    crate::content_filter::start_automated_scanner(data.clone(), ctx.clone());
    crate::content_filter::heuristic::start_cleanup_interval();
    crate::cron::start(data.clone(), ctx.clone());
    crate::utils::message_reports::start_kv_cleanup_job();
}
