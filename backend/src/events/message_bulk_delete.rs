use poise::serenity_prelude as serenity;

use crate::Data;

/// Handles the MessageBulkDelete event.
///
/// - Marks all deleted messages in the message buffer.
pub async fn handle(
    ctx: &serenity::Context,
    channel_id: serenity::ChannelId,
    multiple_deleted_messages_ids: &[serenity::MessageId],
    data: &Data,
) {
    let mut ids = Vec::with_capacity(multiple_deleted_messages_ids.len());
    for message_id in multiple_deleted_messages_ids {
        if let Some(message) = ctx.cache.message(channel_id, *message_id) {
            if message.author.bot
                || message.webhook_id.is_some()
                || is_system_message_kind(message.kind)
            {
                continue;
            }
        }

        ids.push(message_id.to_string());
    }

    if ids.is_empty() || data.message_manager.has_any_exclusion(&ids).await {
        return;
    }

    let _ = data.message_manager.bulk_delete(&data.db, &ids).await;
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
