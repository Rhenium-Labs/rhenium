use crate::{Context, Error};
use poise::serenity_prelude::{self as serenity, CreateEmbed};
use sea_orm::{ConnectionTrait, DatabaseBackend, EntityTrait, PaginatorTrait, Statement};

/// Developer-only command: show process and database stats.
///
#[poise::command(prefix_command, hide_in_help, aliases("proc", "process"))]
pub async fn stats(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();

    // Developer check.
    if !data
        .global_config
        .is_developer(&ctx.author().id.to_string())
    {
        return Ok(());
    }

    let process_uptime = crate::utils::format_duration_ms(crate::process_uptime_ms());
    let client_uptime = crate::utils::format_duration_ms(crate::events::ready::client_uptime_ms());

    // Cache stats.
    let cache = ctx.serenity_context().cache.as_ref();
    let guild_count = cache.guild_count();
    let user_count = cache.user_count();
    let mut channel_count = 0usize;
    let mut member_count = 0usize;
    for guild_id in cache.guilds() {
        if let Some(guild) = guild_id.to_guild_cached(ctx.serenity_context()) {
            channel_count += guild.channels.len();
            member_count += guild.members.len();
        }
    }

    // Database size.
    let db_size = {
        let stmt = Statement::from_string(
            DatabaseBackend::Postgres,
            "SELECT pg_database_size(current_database()) / (1024 * 1024) as size_in_mb".to_string(),
        );
        data.db
            .query_one(stmt)
            .await
            .ok()
            .flatten()
            .and_then(|row| {
                use sea_orm::TryGetable;
                i64::try_get_by(&row, "size_in_mb").ok()
            })
            .unwrap_or(0)
    };

    // Message count.
    let message_count = crate::lib::entities::message::Entity::find()
        .count(&data.db)
        .await
        .unwrap_or(0) as i64;

    // Memory: private data / virtual / resident — read from /proc/self/status (Linux only).
    let memory_info = {
        let status = tokio::fs::read_to_string("/proc/self/status")
            .await
            .unwrap_or_default();
        let parse_kb = |prefix: &str| -> u64 {
            status
                .lines()
                .find(|l| l.starts_with(prefix))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse::<u64>().ok())
                .map(|kb| kb / 1024)
                .unwrap_or(0)
        };
        format!(
            "{} MB / {} MB / {} MB",
            parse_kb("VmData:"),
            parse_kb("VmSize:"),
            parse_kb("VmRSS:"),
        )
    };

    // Heartbeat/ping.
    let heartbeat_ms = ctx.ping().await.as_millis();
    let shard_latency = format!("{heartbeat_ms}ms");

    let message_buffer = data.message_manager.size().await;

    let embed = CreateEmbed::new()
        .color(0x23272a) // Colors.NotQuiteBlack
        .author(
            serenity::CreateEmbedAuthor::new(cache.current_user().name.clone())
                .icon_url(cache.current_user().face()),
        )
        .fields(vec![
            ("Heartbeat", shard_latency, true),
            ("Client Uptime", client_uptime, true),
            ("Process Uptime", process_uptime, true),
            ("Memory Usage", memory_info, true),
            (
                "Cached Entities",
                format!(
                    "{} Users / {} Guilds / {} Channels / {} Members / {} Messages",
                    user_count, guild_count, channel_count, member_count, message_buffer
                ),
                true,
            ),
            (
                "Database Summary",
                format!("{db_size} MB / {message_count} Messages"),
                true,
            ),
        ])
        .timestamp(serenity::Timestamp::now())
        .footer(serenity::CreateEmbedFooter::new(format!(
            "Client ID: {}",
            cache.current_user().id
        )));

    ctx.send(poise::CreateReply::default().embed(embed)).await?;

    Ok(())
}
