use poise::serenity_prelude as serenity;
use tracing::error;

use crate::Data;

/// Handles the delete report message button.
///
/// - Deletes the original or reference message from a report.
/// - Updates the report embed with deletion flag.
/// - Disables the delete button after use.
pub async fn handle(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    _data: &Data,
) {
    let custom_id = &interaction.data.custom_id;

    // Parse type (original/reference), channel_id, and message_id from custom_id.
    // Format: delete-{type}-report-message-{channel_id}-{message_id}
    let parts: Vec<&str> = custom_id.split('-').collect();
    if parts.len() < 6 {
        let _ = interaction
            .create_response(
                ctx,
                serenity::CreateInteractionResponse::Message(
                    serenity::CreateInteractionResponseMessage::new()
                        .content("Invalid delete-report payload.")
                        .ephemeral(true),
                ),
            )
            .await;
        return;
    }

    let msg_type = parts[1]; // "original" or "reference"
    let channel_id_str = parts[4];
    let message_id_str = parts[5];

    let _ = interaction.defer(ctx).await;

    let channel_id = match channel_id_str.parse::<u64>() {
        Ok(id) => serenity::ChannelId::new(id),
        Err(_) => {
            let _ = interaction.create_followup(ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content(format!("Failed to fetch channel `{}`.", channel_id_str))
                    .ephemeral(true),
            ).await;
            return;
        }
    };

    let message_id = match message_id_str.parse::<u64>() {
        Ok(id) => serenity::MessageId::new(id),
        Err(_) => {
            let _ = interaction.create_followup(ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content("Invalid delete-report payload.")
                    .ephemeral(true),
            ).await;
            return;
        }
    };

    let disable_prefix = format!("delete-{}-report-message", msg_type);
    let updated_components_on_graceful =
        rebuild_action_rows(&interaction.message.components, &disable_prefix);

    let channel = match channel_id.to_channel(ctx).await.ok().and_then(|c| c.guild()) {
        Some(c) => c,
        None => {
            let _ = interaction.edit_response(ctx,
                serenity::EditInteractionResponse::new()
                    .embeds(
                        interaction
                            .message
                            .embeds
                            .iter()
                            .cloned()
                            .map(serenity::CreateEmbed::from)
                            .collect::<Vec<_>>(),
                    )
                    .components(updated_components_on_graceful),
            ).await;
            let _ = interaction.create_followup(ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content(format!("Failed to fetch channel `{}`.", channel_id_str))
                    .ephemeral(true),
            ).await;
            return;
        }
    };

    let guild_id = match interaction.guild_id {
        Some(id) => id,
        None => return,
    };

    // Bot permission check.
    let bot_id = ctx.cache.current_user().id;
    let bot_member = guild_id.member(ctx, bot_id).await.ok();
    let bot_can_manage = bot_member
        .as_ref()
        .and_then(|bot_member| {
            guild_id
                .to_guild_cached(ctx)
                .map(|guild| guild.user_permissions_in(&channel, bot_member).manage_messages())
        })
        .unwrap_or(false);
    if !bot_can_manage {
        let _ = interaction.create_followup(ctx,
            serenity::CreateInteractionResponseFollowup::new()
                .content(format!(
                    "I do not have permission to manage messages in <#{}>.",
                    channel.id
                ))
                .ephemeral(true),
        ).await;
        return;
    }

    // Executor permission check.
    let executor_member = guild_id.member(ctx, interaction.user.id).await.ok();
    let executor_can_manage = executor_member
        .as_ref()
        .and_then(|executor_member| {
            guild_id
                .to_guild_cached(ctx)
                .map(|guild| guild.user_permissions_in(&channel, executor_member).manage_messages())
        })
        .unwrap_or(false);
    if !executor_can_manage {
        let _ = interaction.create_followup(ctx,
            serenity::CreateInteractionResponseFollowup::new()
                .content(format!(
                    "You do not have permission to manage messages in <#{}>.",
                    channel.id
                ))
                .ephemeral(true),
        ).await;
        return;
    }

    // Try to delete the message.
    match channel_id.delete_message(ctx, message_id).await {
        Ok(_) => {
            // Update the embed to add a deletion flag.
            let deletion_note = format!(
                "{} Deleted (by <@{}>)",
                if msg_type == "reference" { "Reference" } else { "Message" },
                interaction.user.id,
            );

            // Rebuild components from the original message and disable only delete-{type} buttons.
            let updated_components = rebuild_action_rows(&interaction.message.components, &disable_prefix);

            // Update embeds to append/update the "Flags" field.
            let mut updated_embeds = Vec::new();
            for embed in &interaction.message.embeds {
                let target_author = if msg_type == "reference" { "Message Reference" } else { "New Message Report" };
                let is_target = embed.author.as_ref().map(|a| a.name == target_author).unwrap_or(false);

                if !is_target {
                    // Non-target embeds are passed through unchanged.
                    updated_embeds.push(serenity::CreateEmbed::from(embed.clone()));
                    continue;
                }

                // Build modified field list: update or append the "Flags" field.
                let mut fields: Vec<(String, String, bool)> = embed
                    .fields
                    .iter()
                    .map(|f| (f.name.clone(), f.value.clone(), f.inline))
                    .collect();
                if let Some(idx) = fields.iter().position(|f| f.0 == "Flags") {
                    let current = fields[idx].1.clone();
                    fields[idx].1 = if current.is_empty() {
                        deletion_note.clone()
                    } else {
                        format!("{current}, {deletion_note}")
                    };
                } else {
                    fields.push(("Flags".to_string(), deletion_note.clone(), false));
                }

                // Build the embed fresh from individual properties to avoid field duplication
                // that would occur if we used CreateEmbed::from(embed) and then called .fields().
                let mut new_embed = serenity::CreateEmbed::new();
                if let Some(ref author) = embed.author {
                    let mut ea = serenity::CreateEmbedAuthor::new(author.name.clone());
                    if let Some(ref icon) = author.icon_url {
                        ea = ea.icon_url(icon);
                    }
                    if let Some(ref url) = author.url {
                        ea = ea.url(url);
                    }
                    new_embed = new_embed.author(ea);
                }
                if let Some(color) = embed.colour {
                    new_embed = new_embed.color(color.0);
                }
                if let Some(ref desc) = embed.description {
                    new_embed = new_embed.description(desc);
                }
                if let Some(ref footer) = embed.footer {
                    let mut ef = serenity::CreateEmbedFooter::new(footer.text.clone());
                    if let Some(ref icon) = footer.icon_url {
                        ef = ef.icon_url(icon);
                    }
                    new_embed = new_embed.footer(ef);
                }
                if let Some(ref image) = embed.image {
                    new_embed = new_embed.image(&image.url);
                }
                if let Some(ref thumbnail) = embed.thumbnail {
                    new_embed = new_embed.thumbnail(&thumbnail.url);
                }
                if let Some(ref title) = embed.title {
                    new_embed = new_embed.title(title);
                }
                if let Some(ref url) = embed.url {
                    new_embed = new_embed.url(url);
                }
                if let Some(timestamp) = embed.timestamp {
                    new_embed = new_embed.timestamp(timestamp);
                }
                new_embed = new_embed.fields(fields);

                updated_embeds.push(new_embed);
            }

            let _ = interaction.edit_response(ctx,
                serenity::EditInteractionResponse::new()
                    .embeds(updated_embeds)
                    .components(updated_components),
            ).await;

            let _ = interaction.create_followup(ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content(format!("Successfully deleted message `{}` in <#{}>.", message_id_str, channel_id_str))
                    .ephemeral(true),
            ).await;
        }
        Err(e) => {
            error!("Failed to delete message {}: {e}", message_id_str);
            let _ = interaction.create_followup(ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content(format!("Failed to delete message `{}` in <#{}>.", message_id_str, channel_id_str))
                    .ephemeral(true),
            ).await;
        }
    }
}

fn rebuild_action_rows(
    rows: &[serenity::ActionRow],
    disabled_custom_id_prefix: &str,
) -> Vec<serenity::CreateActionRow> {
    let mut rebuilt = Vec::new();

    for row in rows {
        let mut buttons = Vec::new();

        for component in &row.components {
            if let serenity::ActionRowComponent::Button(button) = component {
                if let Some(created) = rebuild_button(button, disabled_custom_id_prefix) {
                    buttons.push(created);
                }
            }
        }

        if !buttons.is_empty() {
            rebuilt.push(serenity::CreateActionRow::Buttons(buttons));
        }
    }

    rebuilt
}

fn rebuild_button(
    button: &serenity::Button,
    disabled_custom_id_prefix: &str,
) -> Option<serenity::CreateButton> {
    match &button.data {
        serenity::ButtonKind::NonLink { custom_id, style } => {
            let mut btn = serenity::CreateButton::new(custom_id);
            btn = btn.style(*style);
            if let Some(ref label) = button.label {
                btn = btn.label(label);
            }
            if let Some(ref emoji) = button.emoji {
                btn = btn.emoji(emoji.clone());
            }
            let disabled = if custom_id.starts_with(disabled_custom_id_prefix) {
                true
            } else {
                button.disabled
            };
            Some(btn.disabled(disabled))
        }
        serenity::ButtonKind::Link { url } => {
            let mut btn = serenity::CreateButton::new_link(url);
            if let Some(ref label) = button.label {
                btn = btn.label(label);
            }
            if let Some(ref emoji) = button.emoji {
                btn = btn.emoji(emoji.clone());
            }
            Some(btn.disabled(button.disabled))
        }
        serenity::ButtonKind::Premium { .. } => None,
    }
}
