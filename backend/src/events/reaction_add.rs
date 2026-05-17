use dashmap::DashSet;
use poise::serenity_prelude as serenity;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use tracing::error;

use crate::Data;

/// Locks to prevent concurrent quick mute actions on the same target.
static QUICK_MUTE_LOCKS: LazyLock<DashSet<String>> = LazyLock::new(DashSet::new);
/// Locks to prevent concurrent quick purge actions on the same message.
static QUICK_PURGE_LOCKS: LazyLock<DashSet<String>> = LazyLock::new(DashSet::new);

/// Maximum age of messages that can be bulk deleted (14 days in ms).
const BULK_DELETE_MAX_AGE_MS: i64 = 14 * 24 * 60 * 60 * 1000;
/// Maximum number of messages that can be bulk deleted at once.
const BULK_DELETE_LIMIT: usize = 100;
/// Delay between individual deletions to reduce rate-limit pressure.
const INDIVIDUAL_DELETE_DELAY_MS: u64 = 50;
/// Max concurrently deleted messages in single-delete path.
const MAX_CONCURRENT_DELETIONS: usize = 10;
/// Discord epoch: 2015-01-01T00:00:00.000Z
const DISCORD_EPOCH: i64 = 1_420_070_400_000;

#[derive(Debug, Clone)]
struct QuickPurgeResult {
    ok: bool,
    deleted: u32,
    failed: u32,
    entries: Vec<String>,
    log_url: Option<String>,
    message: Option<String>,
}

/// Handles the ReactionAdd event.
///
/// - Checks if the reaction is a quick mute trigger.
/// - Checks if the reaction is a quick purge trigger.
/// - Executes the appropriate action with logging.
pub async fn handle(
    ctx: &serenity::Context,
    reaction: &serenity::Reaction,
    data: &Data,
) {
    let guild_id = match reaction.guild_id {
        Some(id) => id,
        None => return,
    };

    let reactor_id = match reaction.user_id {
        Some(id) => id,
        None => return,
    };

    // Get emoji identifier.
    let emoji_id = match &reaction.emoji {
        serenity::ReactionType::Custom { id, .. } => id.to_string(),
        serenity::ReactionType::Unicode(s) => s.clone(),
        _ => return,
    };

    let guild_id_str = guild_id.to_string();
    let reactor_id_str = reactor_id.to_string();

    let config = data.config_manager.get_guild_config(&data.db, guild_id).await;

    let ctx_mute = ctx.clone();
    let reaction_mute = reaction.clone();
    let data_mute = data.clone();
    let config_mute = config.clone();
    let guild_id_str_mute = guild_id_str.clone();
    let reactor_id_str_mute = reactor_id_str.clone();
    let emoji_id_mute = emoji_id.clone();
    tokio::spawn(async move {
        handle_quick_mute(
            &ctx_mute,
            &reaction_mute,
            &data_mute,
            &config_mute,
            &guild_id_str_mute,
            &reactor_id_str_mute,
            &emoji_id_mute,
            guild_id,
            reactor_id,
        )
        .await;
    });

    let ctx_purge = ctx.clone();
    let reaction_purge = reaction.clone();
    let data_purge = data.clone();
    let config_purge = config;
    tokio::spawn(async move {
        handle_quick_purge(
            &ctx_purge,
            &reaction_purge,
            &data_purge,
            &config_purge,
            &guild_id_str,
            &reactor_id_str,
            &emoji_id,
            guild_id,
            reactor_id,
        )
        .await;
    });
}

/// Handles quick mute reactions.
#[allow(clippy::too_many_arguments)]
async fn handle_quick_mute(
    ctx: &serenity::Context,
    reaction: &serenity::Reaction,
    data: &Data,
    config: &crate::lib::config::guild::GuildConfig,
    guild_id_str: &str,
    reactor_id_str: &str,
    emoji_id: &str,
    guild_id: serenity::GuildId,
    reactor_id: serenity::UserId,
) {
    use crate::lib::config::schema::{LoggingEvent, UserPermission};

    let quick_mute_config = match config.parse_quick_mutes_config() {
        Some(cfg) => cfg,
        None => return,
    };

    // Check if this reaction matches a configured quick mute.
    let qm = match crate::lib::entities::quick_mute::Entity::find()
        .filter(crate::lib::entities::quick_mute::Column::UserId.eq(reactor_id_str))
        .filter(crate::lib::entities::quick_mute::Column::GuildId.eq(guild_id_str))
        .filter(crate::lib::entities::quick_mute::Column::Reaction.eq(emoji_id))
        .one(&data.db)
        .await
    {
        Ok(Some(r)) => r,
        _ => return,
    };

    let duration: i64 = qm.duration;
    let reason = qm.reason.clone();
    let purge_amount: i32 = qm.purge_amount;

    let target_id = if let Some(id) = reaction.message_author_id {
        id
    } else {
        match resolve_message_author_id(data, reaction.message_id).await {
            Some(id) => id,
            None => return,
        }
    };

    // DashSet::insert returns true if the value was not present (acquired), false if already present.
    let mute_key = target_id.to_string();
    if !QUICK_MUTE_LOCKS.insert(mute_key.clone()) {
        return;
    }
    let _lock_guard = scopeguard::guard(mute_key.clone(), |key| {
        QUICK_MUTE_LOCKS.remove(&key);
    });

    // Fetch executor member.
    let executor = match guild_id.member(ctx, reactor_id).await {
        Ok(m) => m,
        Err(_) => return,
    };

    // Permission check.
    if !config.has_permission(&executor, UserPermission::UseQuickMute) {
        return;
    }

    // Channel scoping check.
    let parsed_scoping = crate::utils::ChannelScoping {
        included: quick_mute_config.channel_scoping.iter()
            .filter(|s| s.scoping_type == crate::lib::config::schema::ChannelScopingType::Include)
            .map(|s| s.channel_id.clone())
            .collect(),
        excluded: quick_mute_config.channel_scoping.iter()
            .filter(|s| s.scoping_type == crate::lib::config::schema::ChannelScopingType::Exclude)
            .map(|s| s.channel_id.clone())
            .collect(),
    };
    let (scope_channel_id, thread_id, category_id) =
        resolve_channel_scope_ids(ctx, reaction.channel_id).await;
    if !crate::utils::channel_in_scope_resolved(
        &scope_channel_id,
        thread_id.as_deref(),
        category_id.as_deref(),
        &parsed_scoping,
    ) {
        return;
    }

    // Fetch target member.
    let mut target = match guild_id.member(ctx, target_id).await {
        Ok(m) => m,
        Err(_) => return,
    };

    // Check if already muted.
    if target
        .communication_disabled_until
        .is_some_and(|until| until > serenity::Timestamp::now())
    {
        config.log(
            ctx.http.as_ref(),
            LoggingEvent::QuickMuteResult,
            serenity::ExecuteWebhook::new().content(
                format!("{}, {} is already muted.", executor, target),
            ),
        ).await;
        return;
    }

    // Bot needs timeout permission in the channel.
    let bot_id = ctx.cache.current_user().id;
    let bot_member = guild_id.member(ctx, bot_id).await.ok();

    #[allow(deprecated)]
    let bot_has_moderate_members = reaction
        .channel_id
        .to_channel(ctx)
        .await
        .ok()
        .and_then(|c| c.guild())
        .and_then(|gc| {
            bot_member.as_ref().and_then(|bot_member| {
                guild_id
                    .to_guild_cached(ctx)
                    .map(|guild| guild.user_permissions_in(&gc, bot_member).moderate_members())
            })
        })
        .unwrap_or(false);
    if !bot_has_moderate_members {
        config.log(
            ctx.http.as_ref(),
            LoggingEvent::QuickMuteResult,
            serenity::ExecuteWebhook::new().content(
                format!(
                    "{}, I do not have the \"Timeout Members\" permission which is required to mute {}.",
                    executor, target
                ),
            ),
        )
        .await;
        return;
    }

    let (guild_owner_id, guild_roles) = match guild_id.to_guild_cached(ctx) {
        Some(guild) => (Some(guild.owner_id), Some(guild.roles.clone())),
        None => (None, None),
    };

    // Validate moderation action.
    let validation = crate::utils::moderation::validate_action(
        target.user.id,
        Some(&target),
        &executor,
        bot_id,
        "Quick Mute",
        guild_owner_id,
        bot_member.as_ref(),
        guild_roles.as_ref(),
    );
    if !validation.ok {
        config.log(
            ctx.http.as_ref(),
            LoggingEvent::QuickMuteResult,
            serenity::ExecuteWebhook::new().content(format!("{}, {}", executor, validation.message.as_deref().unwrap_or("Unknown error"))),
        ).await;
        return;
    }

    let timeout_reason = crate::utils::truncate(
        &format!(
            "Quick mute issued by @{} ({}) - {}",
            executor.user.name, executor.user.id, reason
        ),
        512,
    );

    // Execute timeout.
    let timeout_until = chrono::Utc::now() + chrono::Duration::milliseconds(duration);
    let formatted_duration = crate::utils::format_duration_ms(duration as u64);

    match target
        .edit(
            ctx,
            serenity::EditMember::new()
                .disable_communication_until_datetime(serenity::Timestamp::from(timeout_until))
                .audit_log_reason(&timeout_reason),
        )
        .await
    {
        Ok(_) => {}
        Err(e) => {
            error!("Failed to quick mute {} in {}: {e}", target_id, guild_id);
            let event_id = sentry::capture_error(&e);
            config.log(
                ctx.http.as_ref(),
                LoggingEvent::QuickMuteResult,
                serenity::ExecuteWebhook::new().content(
                    format!(
                        "{}, an error occurred while executing quick mute on {}. Please use this ID when reporting the bug: `{}`.",
                        executor, target, event_id
                    ),
                ),
            ).await;
            return;
        }
    }

    let purge_limit = quick_mute_config.purge_limit.min(purge_amount as u32);
    let purge_result = if purge_limit > 1 {
        Some(
            execute_purge(
                ctx,
                data,
                reaction.channel_id,
                target_id,
                reaction.message_id,
                purge_limit,
            )
            .await,
        )
    } else {
        let _ = reaction.channel_id.delete_message(ctx, reaction.message_id).await;
        None
    };

    // Build log embed.
    let mut embed = serenity::CreateEmbed::new()
        .author(serenity::CreateEmbedAuthor::new(format!("Quick Mute Executed ({})", formatted_duration)))
        .thumbnail(target.user.face())
        .color(0x3498DB) // Colors.Blue
        .fields(vec![
            ("Target", crate::utils::user_mention_with_id(&target_id.to_string()), false),
            ("Executor", crate::utils::user_mention_with_id(&reactor_id.to_string()), false),
            ("Reason", reason.clone(), false),
        ])
        .timestamp(serenity::Timestamp::now());

    if let Some(purge_result) = &purge_result {
        if purge_result.deleted > 0 {
        embed = embed.field(
            "Messages Purged",
            format!(
                "{} {}{}{}",
                purge_result.deleted,
                if purge_result.deleted == 1 { "message" } else { "messages" },
                if purge_result.failed > 0 {
                    format!(" ({} failed)", purge_result.failed)
                } else {
                    String::new()
                },
                purge_result
                    .log_url
                    .as_ref()
                    .map(|url| format!("- [View Deleted Messages]({url})"))
                    .unwrap_or_default()
            ),
            false,
        );
        }
    }

    let content = if let Some(purge_result) = &purge_result {
        if purge_result.deleted > 0 {
        format!(
            "{}, successfully quick muted {} for `{}` and purged `{}`/`{}` {} in <#{}>.",
            executor, target, formatted_duration, purge_result.deleted, purge_limit,
            if purge_result.deleted == 1 { "message" } else { "messages" },
            reaction.channel_id,
        )
        } else {
            format!("{}, successfully quick muted {} for `{}`.", executor, target, formatted_duration)
        }
    } else {
        format!("{}, successfully quick muted {} for `{}`.", executor, target, formatted_duration)
    };

    let mut result_payload = serenity::ExecuteWebhook::new().content(&content);
    let mut result_files: Vec<serenity::CreateAttachment> = Vec::new();
    if let Some(purge_result) = &purge_result {
        if purge_result.deleted > 0 {
        result_files.push(serenity::CreateAttachment::bytes(
            purge_result.entries.join("\n\n").into_bytes(),
            "log-data.txt",
        ));
        if let Some(url) = &purge_result.log_url {
            let button = serenity::CreateButton::new_link(url).label("Open In Browser");
            result_payload =
                result_payload.components(vec![serenity::CreateActionRow::Buttons(vec![button])]);
        }
        }
    }

    config.log(
        ctx.http.as_ref(),
        LoggingEvent::QuickMuteExecuted,
        serenity::ExecuteWebhook::new().embed(embed),
    ).await;
    config.log_with_files(
        ctx.http.as_ref(),
        LoggingEvent::QuickMuteResult,
        result_payload,
        result_files,
    ).await;

}

/// Handles quick purge reactions.
#[allow(clippy::too_many_arguments)]
async fn handle_quick_purge(
    ctx: &serenity::Context,
    reaction: &serenity::Reaction,
    data: &Data,
    config: &crate::lib::config::guild::GuildConfig,
    guild_id_str: &str,
    reactor_id_str: &str,
    emoji_id: &str,
    guild_id: serenity::GuildId,
    reactor_id: serenity::UserId,
) {
    use crate::lib::config::schema::{LoggingEvent, UserPermission};

    let quick_purge_config = match config.parse_quick_purges_config() {
        Some(cfg) => cfg,
        None => return,
    };

    // Check if this reaction matches a configured quick purge.
    let qp = match crate::lib::entities::quick_purge::Entity::find()
        .filter(crate::lib::entities::quick_purge::Column::UserId.eq(reactor_id_str))
        .filter(crate::lib::entities::quick_purge::Column::GuildId.eq(guild_id_str))
        .filter(crate::lib::entities::quick_purge::Column::Reaction.eq(emoji_id))
        .one(&data.db)
        .await
    {
        Ok(Some(r)) => r,
        _ => return,
    };

    let purge_amount: i32 = qp.purge_amount;
    if purge_amount <= 0 {
        return;
    }

    let target_id = if let Some(id) = reaction.message_author_id {
        id
    } else {
        match resolve_message_author_id(data, reaction.message_id).await {
            Some(id) => id,
            None => return,
        }
    };

    let purge_key = target_id.to_string();
    if !QUICK_PURGE_LOCKS.insert(purge_key.clone()) {
        return;
    }
    let _lock_guard = scopeguard::guard(purge_key.clone(), |key| {
        QUICK_PURGE_LOCKS.remove(&key);
    });

    // Fetch executor member.
    let executor = match guild_id.member(ctx, reactor_id).await {
        Ok(m) => m,
        Err(_) => return,
    };

    // Permission check.
    if !config.has_permission(&executor, UserPermission::UseQuickPurge) {
        return;
    }

    // Channel scoping check.
    let parsed_scoping = crate::utils::ChannelScoping {
        included: quick_purge_config.channel_scoping.iter()
            .filter(|s| s.scoping_type == crate::lib::config::schema::ChannelScopingType::Include)
            .map(|s| s.channel_id.clone())
            .collect(),
        excluded: quick_purge_config.channel_scoping.iter()
            .filter(|s| s.scoping_type == crate::lib::config::schema::ChannelScopingType::Exclude)
            .map(|s| s.channel_id.clone())
            .collect(),
    };
    let (scope_channel_id, thread_id, category_id) =
        resolve_channel_scope_ids(ctx, reaction.channel_id).await;
    if !crate::utils::channel_in_scope_resolved(
        &scope_channel_id,
        thread_id.as_deref(),
        category_id.as_deref(),
        &parsed_scoping,
    ) {
        return;
    }

    // Target must be in guild.
    let target = match guild_id.member(ctx, target_id).await {
        Ok(m) => m,
        Err(_) => return,
    };

    // Fetch the channel once for both permission checks below.
    // `permissions_for_user` is avoided here because it looks up the member from the guild's
    // member cache, which is not populated by HTTP fetches. We use `user_permissions_in` with
    // the Member structs we already hold instead.
    #[allow(deprecated)]
    let gc = reaction.channel_id.to_channel(ctx).await.ok().and_then(|c| c.guild());

    // Executor must have Manage Messages in this channel.
    let executor_has_manage_messages = gc.as_ref()
        .and_then(|gc| {
            guild_id
                .to_guild_cached(ctx)
                .map(|guild| guild.user_permissions_in(gc, &executor).manage_messages())
        })
        .unwrap_or(false);
    if !executor_has_manage_messages {
        config.log(
            ctx.http.as_ref(),
            LoggingEvent::QuickPurgeResult,
            serenity::ExecuteWebhook::new().content(
                format!(
                    "{}, you do not have permission to manage messages in <#{}>.",
                    executor, reaction.channel_id
                ),
            ),
        )
        .await;
        return;
    }

    // Bot must also have Manage Messages in this channel.
    let bot_id = ctx.cache.current_user().id;
    let bot_member = guild_id.member(ctx, bot_id).await.ok();
    let bot_has_manage_messages = match (gc.as_ref(), bot_member.as_ref()) {
        (Some(gc), Some(bot_member)) => guild_id
            .to_guild_cached(ctx)
            .map(|guild| guild.user_permissions_in(gc, bot_member).manage_messages())
            .unwrap_or(false),
        _ => false,
    };
    if !bot_has_manage_messages {
        config.log(
            ctx.http.as_ref(),
            LoggingEvent::QuickPurgeResult,
            serenity::ExecuteWebhook::new().content(
                format!(
                    "{}, I do not have permission to manage messages in <#{}>, which is required to purge messages.",
                    executor, reaction.channel_id
                ),
            ),
        )
        .await;
        return;
    }

    let max_limit = quick_purge_config.max_limit.min(purge_amount as u32);
    let purge_result = execute_purge(
        ctx,
        data,
        reaction.channel_id,
        target_id,
        reaction.message_id,
        max_limit,
    )
    .await;

    if !purge_result.ok || purge_result.deleted == 0 {
        config.log(
            ctx.http.as_ref(),
            LoggingEvent::QuickPurgeResult,
            serenity::ExecuteWebhook::new().content(format!(
                "{}, failed to quick purge messages for {}: {}",
                executor,
                target,
                purge_result
                    .message
                    .as_deref()
                    .unwrap_or("Unknown error")
            )),
        )
        .await;
        return;
    }

    // Build log embed.
    let embed = serenity::CreateEmbed::new()
        .author(serenity::CreateEmbedAuthor::new("Quick Purge Executed"))
        .thumbnail(target.user.face())
        .color(0x3498DB) // Colors.Blue
        .fields(vec![
            ("Target", crate::utils::user_mention_with_id(&target_id.to_string()), false),
            ("Executor", crate::utils::user_mention_with_id(&reactor_id.to_string()), false),
            ("Channel", format!("<#{}>", reaction.channel_id), false),
            (
                "Purge Result",
                format!(
                    "{} {}{}{}",
                    purge_result.deleted,
                    if purge_result.deleted == 1 { "message" } else { "messages" },
                    if purge_result.failed > 0 {
                        format!(" ({} failed)", purge_result.failed)
                    } else {
                        String::new()
                    },
                    purge_result
                        .log_url
                        .as_ref()
                        .map(|url| format!(" - [View Deleted Messages]({url})"))
                        .unwrap_or_default()
                ),
                false,
            ),
        ])
        .timestamp(serenity::Timestamp::now());

    let content = format!(
        "{}, successfully purged `{}`/`{}` {} from {} in <#{}>.",
        executor, purge_result.deleted, max_limit,
        if purge_result.deleted == 1 { "message" } else { "messages" },
        target, reaction.channel_id,
    );

    let mut result_payload = serenity::ExecuteWebhook::new().content(&content);
    let attachment =
        serenity::CreateAttachment::bytes(purge_result.entries.join("\n\n").into_bytes(), "log-data.txt");
    if let Some(url) = &purge_result.log_url {
        let button = serenity::CreateButton::new_link(url).label("Open In Browser");
        result_payload =
            result_payload.components(vec![serenity::CreateActionRow::Buttons(vec![button])]);
    }

    config.log(
        ctx.http.as_ref(),
        LoggingEvent::QuickPurgeExecuted,
        serenity::ExecuteWebhook::new().embed(embed),
    ).await;
    config.log_with_files(
        ctx.http.as_ref(),
        LoggingEvent::QuickPurgeResult,
        result_payload,
        vec![attachment],
    ).await;

}

/// Executes a purge of messages from a specific author in a channel.
///
/// Returns the number of messages successfully deleted.
async fn execute_purge(
    ctx: &serenity::Context,
    data: &Data,
    channel_id: serenity::ChannelId,
    target_id: serenity::UserId,
    trigger_message_id: serenity::MessageId,
    amount: u32,
) -> QuickPurgeResult {
    let message_ids = fetch_purgeable_message_ids(
        data,
        channel_id,
        target_id,
        amount as usize,
    )
    .await;

    if message_ids.is_empty() {
        return QuickPurgeResult {
            ok: true,
            deleted: 0,
            failed: 0,
            entries: Vec::new(),
            log_url: None,
            message: Some("No messages found to purge.".to_string()),
        };
    }

    let mut deleted = 0u32;
    let mut failed = 0u32;
    let all_ids = message_ids.clone();

    data.message_manager.add_exclusions(&all_ids).await;
    let serialized_messages_task = {
        let data = data.clone();
        let ids = all_ids.clone();
        tokio::spawn(async move { data.message_manager.bulk_delete(&data.db, &ids).await })
    };

    let mut ids_to_delete = message_ids
        .iter()
        .filter_map(|id| id.parse::<u64>().ok().map(serenity::MessageId::new))
        .collect::<Vec<_>>();

    ids_to_delete.retain(|id| *id != trigger_message_id);

    let now = chrono::Utc::now().timestamp_millis();
    let (bulk, individual): (Vec<serenity::MessageId>, Vec<serenity::MessageId>) =
        ids_to_delete
            .into_iter()
            .partition(|id| (now - snowflake_to_timestamp_ms(*id)) < BULK_DELETE_MAX_AGE_MS);

    let delete_trigger = async {
        if channel_id.delete_message(ctx, trigger_message_id).await.is_ok() {
            (1, 0)
        } else {
            (0, 1)
        }
    };

    let (trigger_result, bulk_result, individual_result) = tokio::join!(
        delete_trigger,
        bulk_delete_messages(ctx, channel_id, &bulk),
        individual_delete_messages(ctx, channel_id, &individual),
    );

    deleted += trigger_result.0 + bulk_result.0 + individual_result.0;
    failed += trigger_result.1 + bulk_result.1 + individual_result.1;

    let deleted_messages = match serialized_messages_task.await {
        Ok(messages) => messages,
        Err(_) => data.message_manager.bulk_delete(&data.db, &all_ids).await,
    };
    data.message_manager.remove_exclusions(&all_ids).await;

    let entries = build_message_log_entries(ctx, data, &deleted_messages).await;
    let joined = entries.join("\n\n");
    let log_url = crate::utils::hastebin(&joined, "js").await;

    QuickPurgeResult {
        ok: deleted > 0,
        deleted,
        failed,
        entries,
        log_url,
        message: if deleted == 0 {
            Some("All message deletions failed.".to_string())
        } else {
            None
        },
    }
}

async fn bulk_delete_messages(
    ctx: &serenity::Context,
    channel_id: serenity::ChannelId,
    message_ids: &[serenity::MessageId],
) -> (u32, u32) {
    let mut deleted = 0u32;
    let mut failed = 0u32;

    for chunk in message_ids.chunks(BULK_DELETE_LIMIT) {
        if chunk.is_empty() {
            continue;
        }

        match channel_id.delete_messages(ctx, chunk).await {
            Ok(_) => deleted += chunk.len() as u32,
            Err(_) => {
                let result = individual_delete_messages(ctx, channel_id, chunk).await;
                deleted += result.0;
                failed += result.1;
            }
        }
    }

    (deleted, failed)
}

async fn individual_delete_messages(
    ctx: &serenity::Context,
    channel_id: serenity::ChannelId,
    message_ids: &[serenity::MessageId],
) -> (u32, u32) {
    let mut deleted = 0u32;
    let mut failed = 0u32;

    for (idx, batch) in message_ids.chunks(MAX_CONCURRENT_DELETIONS).enumerate() {
        let mut join_set = tokio::task::JoinSet::new();

        for id in batch {
            let ctx = ctx.clone();
            let message_id = *id;
            join_set.spawn(async move { channel_id.delete_message(&ctx, message_id).await.is_ok() });
        }

        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(true) => deleted += 1,
                _ => failed += 1,
            }
        }

        if (idx + 1) * MAX_CONCURRENT_DELETIONS < message_ids.len() {
            tokio::time::sleep(std::time::Duration::from_millis(INDIVIDUAL_DELETE_DELAY_MS)).await;
        }
    }

    (deleted, failed)
}

async fn resolve_channel_scope_ids(
    ctx: &serenity::Context,
    channel_id: serenity::ChannelId,
) -> (String, Option<String>, Option<String>) {
    let fallback = (channel_id.to_string(), None, None);
    let Some(channel) = channel_id.to_channel(ctx).await.ok() else {
        return fallback;
    };
    let Some(guild_channel) = channel.guild() else {
        return fallback;
    };

    let is_thread = matches!(
        guild_channel.kind,
        serenity::ChannelType::PublicThread
            | serenity::ChannelType::PrivateThread
            | serenity::ChannelType::NewsThread
    );
    if !is_thread {
        return (
            guild_channel.id.to_string(),
            None,
            guild_channel.parent_id.map(|id| id.to_string()),
        );
    }

    let thread_id = guild_channel.id.to_string();
    let Some(parent_channel_id) = guild_channel.parent_id else {
        return (guild_channel.id.to_string(), Some(thread_id), None);
    };

    let category_id = match parent_channel_id.to_channel(ctx).await.ok().and_then(|c| c.guild()) {
        Some(parent_channel) => parent_channel.parent_id.map(|id| id.to_string()),
        None => None,
    };

    (
        parent_channel_id.to_string(),
        Some(thread_id),
        category_id,
    )
}

async fn fetch_purgeable_message_ids(
    data: &Data,
    channel_id: serenity::ChannelId,
    target_id: serenity::UserId,
    limit: usize,
) -> Vec<String> {
    let cached = data
        .message_manager
        .find_matching(&channel_id.to_string(), &target_id.to_string(), limit)
        .await;
    if cached.len() >= limit {
        return cached.into_iter().take(limit).collect();
    }

    let remaining = limit - cached.len();
    let mut out = cached.clone();
    let cached_set: HashSet<String> = cached.into_iter().collect();

    use sea_orm::{QueryOrder, QuerySelect};
    let mut db_query = crate::lib::entities::message::Entity::find()
        .filter(crate::lib::entities::message::Column::ChannelId.eq(channel_id.to_string()))
        .filter(crate::lib::entities::message::Column::AuthorId.eq(target_id.to_string()))
        .filter(crate::lib::entities::message::Column::Deleted.eq(false))
        .order_by_desc(crate::lib::entities::message::Column::CreatedAt)
        .limit(remaining as u64);

    if !cached_set.is_empty() {
        db_query = db_query.filter(
            crate::lib::entities::message::Column::Id.is_not_in(cached_set.iter().cloned().collect::<Vec<_>>())
        );
    }

    if let Ok(rows) = db_query.all(&data.db).await {
        for model in rows {
            if !cached_set.contains(&model.id) {
                out.push(model.id);
                if out.len() >= limit {
                    break;
                }
            }
        }
    }

    out.truncate(limit);
    out
}

fn snowflake_to_timestamp_ms(id: serenity::MessageId) -> i64 {
    (id.get() as i64 >> 22) + DISCORD_EPOCH
}

async fn build_message_log_entries(
    ctx: &serenity::Context,
    data: &Data,
    messages: &[crate::lib::repository::messages::SerializedMessage],
) -> Vec<String> {
    if messages.is_empty() {
        return Vec::new();
    }

    let mut author_cache: HashMap<String, String> = HashMap::new();
    for msg in messages {
        if author_cache.contains_key(&msg.author_id) {
            continue;
        }
        let username = match msg.author_id.parse::<u64>() {
            Ok(id) => serenity::UserId::new(id)
                .to_user(ctx)
                .await
                .map(|u| u.name)
                .unwrap_or_else(|_| "unknown user".to_string()),
            Err(_) => "unknown user".to_string(),
        };
        author_cache.insert(msg.author_id.clone(), username);
    }

    let reference_ids = messages
        .iter()
        .filter_map(|m| m.reference_id.clone())
        .collect::<Vec<_>>();
    let references = data.message_manager.get_many(&data.db, &reference_ids).await;
    let mut reference_map = HashMap::new();
    for msg in references {
        if !author_cache.contains_key(&msg.author_id) {
            let username = match msg.author_id.parse::<u64>() {
                Ok(id) => serenity::UserId::new(id)
                    .to_user(ctx)
                    .await
                    .map(|u| u.name)
                    .unwrap_or_else(|_| "unknown user".to_string()),
                Err(_) => "unknown user".to_string(),
            };
            author_cache.insert(msg.author_id.clone(), username);
        }
        reference_map.insert(msg.id.clone(), msg);
    }

    let mut sorted = messages.to_vec();
    sorted.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    let mut entries = Vec::with_capacity(sorted.len());
    for msg in sorted {
        let author_name = author_cache
            .get(&msg.author_id)
            .cloned()
            .unwrap_or_else(|| "unknown user".to_string());

        let main = format_message_log_entry(ctx, &msg, &author_name).await;
        if let Some(ref_id) = &msg.reference_id {
            if let Some(reference) = reference_map.get(ref_id) {
                let ref_author = author_cache
                    .get(&reference.author_id)
                    .cloned()
                    .unwrap_or_else(|| "unknown user".to_string());
                let ref_entry = format_message_log_entry(ctx, reference, &ref_author).await;
                entries.push(format!("REF: {ref_entry}\n └── {main}"));
                continue;
            }
        }
        entries.push(main);
    }

    entries
}

async fn format_message_log_entry(
    _ctx: &serenity::Context,
    message: &crate::lib::repository::messages::SerializedMessage,
    author_name: &str,
) -> String {
    let timestamp = message
        .created_at
        .with_timezone(&chrono::Utc)
        .format("%m/%d/%Y, %H:%M:%S")
        .to_string();

    // log entries for purge actions, so sticker lookup is intentionally skipped here.
    let content = message
        .content
        .clone()
        .unwrap_or_else(|| "No message content.".to_string());

    let main = format!(
        "[{}] [{}] @{} ({}) - {}",
        message.id, timestamp, author_name, message.author_id, content
    );

    if message.attachments.is_empty() {
        return main;
    }

    let attachments = message
        .attachments
        .iter()
        .enumerate()
        .map(|(idx, url)| format!("   └── #{}: {}", idx + 1, url))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{main}\n{attachments}")
}

async fn resolve_message_author_id(
    data: &Data,
    message_id: serenity::MessageId,
) -> Option<serenity::UserId> {
    let message_id_str = message_id.to_string();
    if let Some(stored) = data.message_manager.get(&data.db, &message_id_str).await {
        if let Ok(author_id) = stored.author_id.parse::<u64>() {
            return Some(serenity::UserId::new(author_id));
        }
    }
    None
}
