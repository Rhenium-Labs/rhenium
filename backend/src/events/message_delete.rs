use poise::serenity_prelude as serenity;

use crate::Data;

/// Handles the MessageDelete event.
///
/// - Marks the message as deleted in the message buffer.
pub async fn handle(
    ctx: &serenity::Context,
    channel_id: serenity::ChannelId,
    deleted_message_id: &serenity::MessageId,
    data: &Data,
) {
    if let Some(message) = ctx.cache.message(channel_id, *deleted_message_id) {
        if message.author.bot
            || message.webhook_id.is_some()
            || is_system_message_kind(message.kind)
        {
            return;
        }
    }

    let id_str = deleted_message_id.to_string();
    if data.message_manager.has_exclusion(&id_str).await {
        return;
    }
    let _ = data.message_manager.delete(&data.db, &id_str).await;
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
