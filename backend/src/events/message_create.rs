use poise::serenity_prelude as serenity;

use crate::Data;

/// Handles the MessageCreate event.
///
/// - Queues message to buffer for database insertion
/// - Runs content filter scanning (if guild is whitelisted)
/// - Runs highlight scanning
pub async fn handle(
    ctx: &serenity::Context,
    new_message: &serenity::Message,
    data: &Data,
) {
    // Ignore bots, webhooks, and system messages.
    if new_message.author.bot
        || new_message.webhook_id.is_some()
        || is_system_message_kind(new_message.kind)
    {
        return;
    }

    let guild_id = match new_message.guild_id {
        Some(id) => id,
        None => return,
    };

    // Check if guild is whitelisted for content filter scanning.
    let is_whitelisted = crate::utils::is_guild_whitelisted(
        &data.db,
        &data.kv,
        &guild_id.to_string(),
    )
    .await;

    // Run queue/highlight (and content filter if whitelisted) concurrently.
    let queue_fut = data.message_manager.queue(new_message, &data.db, &ctx.cache);
    let highlight_fut = crate::commands::highlights::scan_message_for_highlights(
        ctx,
        data,
        new_message,
        guild_id,
    );

    if is_whitelisted {
        let cf_fut = crate::content_filter::scan_message(ctx, data, new_message, guild_id);
        let _ = tokio::join!(queue_fut, highlight_fut, cf_fut);
    } else {
        let _ = tokio::join!(queue_fut, highlight_fut);
    }
}

fn is_system_message_kind(kind: serenity::MessageType) -> bool {
    !matches!(
        kind,
        serenity::MessageType::Regular
            | serenity::MessageType::InlineReply
            | serenity::MessageType::ChatInputCommand
            | serenity::MessageType::ContextMenuCommand
            | serenity::MessageType::ThreadStarterMessage
    )
}
