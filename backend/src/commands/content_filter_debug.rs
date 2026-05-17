use crate::{Context, Error};
use poise::serenity_prelude::{self as serenity, CreateEmbed, CreateEmbedAuthor};
use crate::utils::{hastebin, inflect};

/// Developer-only command: inspect content filter internal state.
///
#[poise::command(prefix_command, hide_in_help, rename = "content-filter-debug", aliases("cfd", "cfstate", "cfstats"))]
pub async fn content_filter_debug(
    ctx: Context<'_>,
    #[description = "Subcommand"] subcommand: Option<String>,
    #[description = "Argument"] arg: Option<String>,
    #[description = "Second argument"] arg2: Option<String>,
) -> Result<(), Error> {
    let data = ctx.data();

    if !data.global_config.is_developer(&ctx.author().id.to_string()) {
        return Ok(());
    }

    let subcommand = subcommand.unwrap_or_else(|| "overview".to_string()).to_lowercase();
    let guild_id = ctx.guild_id().map(|g| g.to_string()).unwrap_or_default();

    match subcommand.as_str() {
        "overview" | "summary" => {
            let target_guild = arg.unwrap_or(guild_id);
            overview(ctx, &target_guild).await
        }
        "channel" => {
            let channel_id = arg.unwrap_or_else(|| ctx.channel_id().to_string());
            channel(ctx, &channel_id).await
        }
        "queue" => {
            let target_guild = arg.unwrap_or(guild_id);
            queue(ctx, &target_guild).await
        }
        "dead" => {
            let limit = arg
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(10);
            dead_letters(ctx, limit).await
        }
        "prioritize" | "priority" => {
            let action = arg.unwrap_or_else(|| "status".to_string()).to_lowercase();
            let target_guild = arg2.unwrap_or_else(|| guild_id.clone());
            prioritize(ctx, &action, &target_guild, &guild_id).await
        }
        _ => {
            ctx.say(format!(
                "Unknown subcommand `{subcommand}`. Available subcommands are: `overview`, `channel`, `queue`, `dead`, `prioritize`."
            ))
            .await?;
            Ok(())
        }
    }
}

async fn overview(ctx: Context<'_>, guild_id: &str) -> Result<(), Error> {
    let cache = ctx.serenity_context().cache.as_ref();
    let diagnostics = crate::content_filter::automated::get_diagnostics(Some(
        crate::content_filter::automated::DiagnosticsFilters {
            guild_id: if guild_id.is_empty() {
                None
            } else {
                Some(guild_id.to_string())
            },
            channel_id: None,
        },
    ));
    let queue = diagnostics.queue;
    let heuristic = crate::content_filter::heuristic::diagnostics();
    let states = diagnostics.states;

    let state_lines = if states.is_empty() {
        "No tracked channels yet.".to_string()
    } else {
        states
            .iter()
            .take(6)
            .enumerate()
            .map(|(idx, state)| {
                let queue_depth = crate::content_filter::scheduler::queue_depth_for_channel(&state.channel_id);
                let channel_display = format_channel_display(ctx, &state.channel_id);

                format!(
                    "{}. {} - {} queued, {} MPM scan rate, {:.1} EWMA, {:.2} false positive ratio.",
                    idx + 1,
                    channel_display,
                    queue_depth,
                    state.scan_rate,
                    state.ewma_mpm,
                    state.false_positive_ratio,
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let retry_label = inflect(queue.retry_jobs as u64, "retry job");
    let next_suffix = queue
        .next_scheduled_at
        .map(|ts| format!(", next <t:{}:R>", ts / 1000))
        .unwrap_or_default();
    let most_active = if state_lines.len() > 1024 {
        format!("{}...", &state_lines[..1021])
    } else {
        state_lines
    };

    let embed = CreateEmbed::new()
        .author(CreateEmbedAuthor::new("Content Filter Diagnostics").icon_url(cache.current_user().face()))
        .color(0x23272a) // Colors.NotQuiteBlack
        .fields(vec![
            (
                "Queue",
                format!(
                    "{} total ({} new, {} {}){}",
                    queue.total,
                    queue.new_jobs,
                    queue.retry_jobs,
                    retry_label,
                    next_suffix,
                ),
                true,
            ),
            (
                "Dead Letters",
                format!(
                    "{} total ({} buffered)",
                    diagnostics.dead_letters.total_recorded,
                    diagnostics.dead_letters.buffered
                ),
                true,
            ),
            (
                "Heuristic Timers",
                format!(
                    "{} {} ({} tracked channels)",
                    heuristic.timers,
                    inflect(heuristic.timers as u64, "timer"),
                    heuristic.tracked_channels
                ),
                true,
            ),
            (
                "Most Active Channels",
                most_active,
                false,
            ),
        ])
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

async fn channel(ctx: Context<'_>, channel_id: &str) -> Result<(), Error> {
    let diagnostics = crate::content_filter::automated::get_diagnostics(Some(
        crate::content_filter::automated::DiagnosticsFilters {
            guild_id: None,
            channel_id: Some(channel_id.to_string()),
        },
    ));
    let Some(state) = diagnostics.states.first() else {
        ctx.say(format!("No state information available for channel with ID `{channel_id}`.")).await?;
        return Ok(());
    };

    let embed = CreateEmbed::new()
        .author(
            CreateEmbedAuthor::new(format!("Content Filter Channel Snapshot - {channel_id}"))
                .icon_url(ctx.serenity_context().cache.current_user().face()),
        )
        .color(0x23272a) // Colors.NotQuiteBlack
        .fields(vec![
            (
                "Queue Depth",
                state.queue_depth.to_string(),
                true,
            ),
            ("Scan Rate", format!("{} / min", state.scan_rate), true),
            ("EWMA MPM", format!("{:.2}", state.ewma_mpm), true),
            (
                "False Positive Ratio",
                format!("{:.3}", state.false_positive_ratio),
                true,
            ),
            (
                "Tracked Users",
                format!("{} {} ({} priority)", state.tracked_users, inflect(state.tracked_users as u64, "user"), state.priority_users),
                true,
            ),
            ("Last Activity", format!("<t:{}:R>", state.last_activity / 1000), true),
        ])
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

async fn queue(ctx: Context<'_>, guild_id: &str) -> Result<(), Error> {
    let diagnostics = crate::content_filter::automated::get_diagnostics(Some(
        crate::content_filter::automated::DiagnosticsFilters {
            guild_id: if guild_id.is_empty() {
                None
            } else {
                Some(guild_id.to_string())
            },
            channel_id: None,
        },
    ));
    let queue = diagnostics.queue;

    let lines = format!(
        "Total: {}\nNew: {}\nRetry: {}\nNext Scheduled: {}\nOldest Enqueued: {}",
        queue.total,
        queue.new_jobs,
        queue.retry_jobs,
        format_timestamp_ms(queue.next_scheduled_at),
        format_timestamp_ms(queue.oldest_enqueued_at),
    );

    let embed = CreateEmbed::new()
        .author(CreateEmbedAuthor::new("Content Filter Queue Snapshot").icon_url(
            ctx.serenity_context().cache.current_user().face(),
        ))
        .color(0x23272a) // Colors.NotQuiteBlack
        .description(format!("```ini\n{lines}\n```"))
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

async fn dead_letters(ctx: Context<'_>, limit: usize) -> Result<(), Error> {
    let diagnostics = crate::content_filter::automated::get_diagnostics(None);
    let dead_total = diagnostics.dead_letters.total_recorded;
    let entries = diagnostics
        .recent_dead_letters
        .into_iter()
        .take(limit.max(1))
        .collect::<Vec<_>>();

    if entries.is_empty() {
        ctx.say("Found no dead-letter entries recorded in memory.").await?;
        return Ok(());
    }

    let body = entries
        .iter()
        .map(|entry| {
            let timestamp = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(entry.created_at as i64)
                .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
                .unwrap_or_else(|| entry.created_at.to_string());
            format!(
                "{} | {} | Source: {}\nMessage: {}\nAttempts: {}/{}",
                timestamp,
                entry.reason,
                entry.job.source,
                entry.job.message_id,
                entry.job.attempts,
                entry.job.max_attempts,
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    if body.len() <= 900 {
        let embed = CreateEmbed::new()
            .author(
                CreateEmbedAuthor::new(format!(
                    "Content Filter Dead Letters (`{}`/`{}`)",
                    entries.len(),
                    dead_total
                ))
                .icon_url(ctx.serenity_context().cache.current_user().face()),
            )
            .color(0x23272a) // Colors.NotQuiteBlack
            .description(format!("```txt\n{}\n```", body))
            .timestamp(serenity::Timestamp::now());

        ctx.send(poise::CreateReply::default().embed(embed)).await?;
        return Ok(());
    }

    let url = hastebin(&body, "txt").await;
    let description = if let Some(url) = url {
        format!("[Open full dead-letter dump]({url})")
    } else {
        "Dead-letter dump was too long to inline.".to_string()
    };

    let embed = CreateEmbed::new()
        .author(
            CreateEmbedAuthor::new("Content Filter Dead Letters")
                .icon_url(ctx.serenity_context().cache.current_user().face()),
        )
        .color(0x23272a) // Colors.NotQuiteBlack
        .description(description)
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

fn format_timestamp_ms(timestamp: Option<u64>) -> String {
    timestamp
        .map(|ts| ts.to_string())
        .unwrap_or_else(|| "none".to_string())
}

fn format_channel_display(ctx: Context<'_>, channel_id: &str) -> String {
    match channel_id.parse::<u64>() {
        Ok(id) => {
            let channel_id_typed = serenity::ChannelId::new(id);
            let is_cached = ctx
                .serenity_context()
                .cache
                .guilds()
                .into_iter()
                .filter_map(|guild_id| guild_id.to_guild_cached(ctx.serenity_context()))
                .any(|guild| guild.channels.contains_key(&channel_id_typed));
            if is_cached {
                format!("<#{channel_id}> (`{channel_id}`)")
            } else {
                format!("`#{channel_id}`")
            }
        }
        Err(_) => format!("`#{channel_id}`"),
    }
}

async fn prioritize(
    ctx: Context<'_>,
    action: &str,
    guild_id: &str,
    default_guild_id: &str,
) -> Result<(), Error> {
    let data = ctx.data();

    match action {
        "list" => {
            let prioritized = crate::content_filter::get_prioritized_guilds();
            if prioritized.is_empty() {
                ctx.say("No guilds are manually prioritized for content-filter scanning right now.").await?;
            } else {
                let list = prioritized.iter().map(|id| format!("- `{id}`")).collect::<Vec<_>>().join("\n");
                ctx.say(format!("Prioritized guilds ({}):\n{list}", prioritized.len())).await?;
            }
        }
        "on" | "enable" | "add" => {
            crate::content_filter::set_guild_priority(&data.db, guild_id, true).await;
            if guild_id == default_guild_id {
                ctx.say("Enabled manual CF prioritization for this guild. New messages will be scanned more aggressively.")
                    .await?;
            } else {
                ctx.say(format!("Enabled manual CF prioritization for guild `{guild_id}`."))
                    .await?;
            }
        }
        "off" | "disable" | "remove" | "clear" => {
            crate::content_filter::set_guild_priority(&data.db, guild_id, false).await;
            if guild_id == default_guild_id {
                ctx.say("Disabled manual CF prioritization for this guild.").await?;
            } else {
                ctx.say(format!("Disabled manual CF prioritization for guild `{guild_id}`."))
                    .await?;
            }
        }
        "status" => {
            let is_prioritized = crate::content_filter::is_guild_prioritized(guild_id);
            let status = if is_prioritized { "enabled" } else { "disabled" };
            if guild_id == default_guild_id {
                ctx.say(format!(
                    "Manual CF prioritization for this guild is currently **{status}**."
                ))
                .await?;
            } else {
                ctx.say(format!(
                    "Manual CF prioritization for guild `{guild_id}` is currently **{status}**."
                ))
                .await?;
            }
        }
        _ => {
            ctx.say("Usage: `.cfd prioritize status [guild_id]`, `.cfd prioritize on [guild_id]`, `.cfd prioritize off [guild_id]`, or `.cfd prioritize list`.").await?;
        }
    }

    Ok(())
}
