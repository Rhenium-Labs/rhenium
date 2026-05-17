use poise::serenity_prelude as serenity;
use crate::Data;

/// Handles the MessageUpdate event.
///
/// - Updates message content in the database when edited.
pub async fn handle(
    ctx: &serenity::Context,
    event: &serenity::MessageUpdateEvent,
    data: &Data,
) {
    if event.author.as_ref().is_some_and(|author| author.bot) {
        return;
    }

    if matches!(event.webhook_id, Some(Some(_))) {
        return;
    }

    if event.kind.is_some_and(is_system_message_kind) {
        return;
    }

    if let Some(content) = &event.content {
        if content.is_empty() {
            return;
        }

        let mentions = event.mentions.as_deref().unwrap_or(&[]);
        let cleaned = crate::utils::messages::clean_content(
            content,
            &ctx.cache,
            event.guild_id,
            mentions,
        );
        let msg_id = event.id.to_string();
        let _old = data
            .message_manager
            .update_content(&data.db, &msg_id, &cleaned)
            .await;
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
