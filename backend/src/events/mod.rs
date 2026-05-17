//! Event dispatcher module.
//!
//! Each event type has its own submodule matching the TS source structure:

pub mod ready;
pub mod message_create;
pub mod message_delete;
pub mod message_bulk_delete;
pub mod message_update;
pub mod guild_create;
pub mod guild_ban_add;
pub mod guild_audit_log;
pub mod interaction_create;
pub mod reaction_add;

use poise::serenity_prelude as serenity;
use tracing::warn;
use crate::{Data, Error};

/// Central event handler dispatching all gateway events to individual modules.
pub async fn handle_event(
    ctx: &serenity::Context,
    event: &serenity::FullEvent,
    _framework: poise::FrameworkContext<'_, Data, Error>,
    data: &Data,
) -> Result<(), Error> {
    match event {
        serenity::FullEvent::Ready { data_about_bot } => {
            ready::handle(ctx, data_about_bot, data).await;
        }

        serenity::FullEvent::Message { new_message } => {
            message_create::handle(ctx, new_message, data).await;
        }

        serenity::FullEvent::MessageDelete {
            channel_id,
            deleted_message_id,
            guild_id: _,
        } => {
            message_delete::handle(ctx, *channel_id, deleted_message_id, data).await;
        }

        serenity::FullEvent::MessageDeleteBulk {
            channel_id,
            multiple_deleted_messages_ids,
            guild_id: _,
        } => {
            message_bulk_delete::handle(ctx, *channel_id, multiple_deleted_messages_ids, data)
                .await;
        }

        serenity::FullEvent::MessageUpdate {
            old_if_available: _,
            new: _,
            event,
        } => {
            message_update::handle(ctx, event, data).await;
        }

        serenity::FullEvent::GuildCreate { guild, is_new } => {
            guild_create::handle(guild, is_new, data).await;
        }

        serenity::FullEvent::GuildBanAddition { banned_user, guild_id } => {
            guild_ban_add::handle(ctx, guild_id, banned_user, data).await;
        }

        serenity::FullEvent::GuildAuditLogEntryCreate { entry, guild_id } => {
            guild_audit_log::handle(ctx, entry, guild_id, data).await;
        }

        serenity::FullEvent::InteractionCreate { interaction } => {
            interaction_create::handle(ctx, interaction, data).await;
        }

        serenity::FullEvent::ReactionAdd { add_reaction } => {
            reaction_add::handle(ctx, add_reaction, data).await;
        }

        serenity::FullEvent::Ratelimit { data: ratelimit_info } => {
            warn!(
                "Discord rate limit hit: timeout={}ms method={:?} path='{}' global={}",
                ratelimit_info.timeout.as_millis(),
                ratelimit_info.method,
                ratelimit_info.path,
                ratelimit_info.global,
            );
        }

        _ => {}
    }

    Ok(())
}
