use poise::serenity_prelude as serenity;

use crate::Data;
use crate::utils::interaction as ia;

/// Handles content filter alert buttons.
///
/// - delete: Deletes the flagged message from the channel.
/// - resolve: Marks the alert as resolved.
/// - false positive: Marks the alert as false positive, feeds back to automated scanner.
/// - content: Shows the detailed content of the flagged message.
pub async fn handle(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
) {
    let custom_id = &interaction.data.custom_id;

    // Parse custom ID exactly like TS parseContentFilterCustomId:
    // - cfb1:del:{messageId}:{channelId}
    // - cfb1:res:{messageId}
    // - cfb1:fp:{channelId}:{messageId}
    // - cfb1:content:{messageId}
    let parts: Vec<&str> = custom_id.split(':').collect();
    if parts.len() < 3 || parts.first().copied() != Some("cfb1") {
        ia::respond_error(ctx, interaction, "Unsupported content filter action payload.").await;
        return;
    }

    let action = parts[1];
    let (channel_id_str, message_id_str) = match action {
        "del" if parts.len() == 4 => (parts[3], parts[2]),
        "res" if parts.len() == 3 => ("", parts[2]),
        "fp" if parts.len() == 4 => (parts[2], parts[3]),
        "content" if parts.len() == 3 => ("", parts[2]),
        _ => {
            ia::respond_error(ctx, interaction, "Unsupported content filter action payload.").await;
            return;
        }
    };

    // Check whitelist.
    if let Some(guild_id) = interaction.guild_id {
        let status = crate::utils::is_guild_whitelisted(&data.db, &data.kv, &guild_id.to_string()).await;
        if !status {
            ia::respond_error(ctx, interaction, "This server is not whitelisted for the AI content filter system.").await;
            return;
        }

        let config = data.config_manager.get_guild_config(&data.db, guild_id).await;
        if config.parse_content_filter_config().is_none() {
            ia::respond_error(ctx, interaction, "Content filter is not configured for this server.").await;
            return;
        }
    }

    match action {
        "del" => handle_delete(ctx, interaction, data, channel_id_str, message_id_str).await,
        "res" => handle_resolve(ctx, interaction, data, message_id_str).await,
        "fp" => handle_false_positive(ctx, interaction, data, channel_id_str, message_id_str).await,
        "content" => handle_view_content(ctx, interaction, data, message_id_str).await,
        _ => {}
    }
}

/// Handle the delete message action.
async fn handle_delete(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
    channel_id_str: &str,
    message_id_str: &str,
) {
    let _ = interaction.defer(ctx).await;

    let channel_id = match channel_id_str.parse::<u64>() {
        Ok(id) => serenity::ChannelId::new(id),
        Err(_) => {
            let _ = interaction
                .create_followup(
                    ctx,
                    serenity::CreateInteractionResponseFollowup::new()
                        .content("Could not find the channel containing the flagged message.")
                        .ephemeral(true),
                )
                .await;
            return;
        }
    };

    let message_id = match message_id_str.parse::<u64>() {
        Ok(id) => serenity::MessageId::new(id),
        Err(_) => {
            let _ = interaction
                .create_followup(
                    ctx,
                    serenity::CreateInteractionResponseFollowup::new()
                        .content("Failed to delete the message. I may lack permissions.")
                        .ephemeral(true),
                )
                .await;
            return;
        }
    };

    // Fetch alert ID (if any) for status updates.
    let alert_id = crate::utils::content_filter::get_alert_by_message_id(&data.db, message_id_str)
        .await
        .ok()
        .flatten()
        .map(|alert| alert.id);

    // Fetch channel to ensure it's text-based.
    let channel = match channel_id.to_channel(ctx).await {
        Ok(channel) => channel,
        Err(_) => {
            let _ = interaction.create_followup(ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content("Could not find the channel containing the flagged message.")
                    .ephemeral(true),
            ).await;
            return;
        }
    };

    let is_text_based = match channel {
        serenity::Channel::Guild(guild_channel) => guild_channel.is_text_based(),
        _ => false,
    };

    if !is_text_based {
        let _ = interaction.create_followup(ctx,
            serenity::CreateInteractionResponseFollowup::new()
                .content("Could not find the channel containing the flagged message.")
                .ephemeral(true),
        ).await;
        return;
    }

    // Try to delete the message.
    match channel_id.delete_message(ctx, message_id).await {
        Ok(_) => {
            if let Some(ref alert_id) = alert_id {
                let _ = crate::utils::content_filter::update_alert_del_status(
                    &data.db,
                    alert_id,
                    crate::content_filter::types::ContentFilterStatus::Deleted,
                )
                .await;
            }
            // Update the submission message to disable delete button.
            update_submission_message(interaction, ctx, "delete", "succeeded", None).await;

            let _ = interaction.create_followup(ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content("Successfully deleted the flagged message. You can still resolve or mark false-positive.")
                    .ephemeral(true),
            ).await;
        }
        Err(err) => {
            // Check if the error is because the message is already deleted (10008)
            let is_missing = err.to_string().contains("10008");

            if is_missing {
                if let Some(ref alert_id) = alert_id {
                    let _ = crate::utils::content_filter::update_alert_del_status(
                        &data.db,
                        alert_id,
                        crate::content_filter::types::ContentFilterStatus::Deleted,
                    )
                    .await;
                }
                // Message already deleted - update submission message with disable-delete mode.
                update_submission_message(interaction, ctx, "delete", "missing", None).await;

                let _ = interaction.create_followup(ctx,
                    serenity::CreateInteractionResponseFollowup::new()
                        .content("The flagged message was already deleted. Delete action is now disabled; you can still resolve or mark false-positive.")
                        .ephemeral(true),
                ).await;
            } else {
                let _ = interaction.create_followup(ctx,
                    serenity::CreateInteractionResponseFollowup::new()
                        .content("Failed to delete the message. I may lack permissions.")
                        .ephemeral(true),
                ).await;
            }
        }
    }
}

/// Update the submission message embed and component state.
async fn update_submission_message(
    interaction: &serenity::ComponentInteraction,
    ctx: &serenity::Context,
    action: &str,
    status: &str,
    footer_text: Option<String>,
) {
    let mut embeds = Vec::new();
    if let Some(embed_data) = interaction.message.embeds.first() {
        let color = match (action, status) {
            ("delete", "succeeded") | ("delete", "missing") => 0x3498DB, // Colors.Blue
            ("resolve", _) => 0x57F287,                                   // Colors.Green
            ("false", _) => 0x23272A,                                     // Colors.NotQuiteBlack
            _ => 0x3498DB,                                                 // Colors.Blue
        };

        let mut fields = embed_data
            .fields
            .iter()
            .filter(|field| {
                !matches!(
                    field.name.as_str(),
                    "Deletion Status"
                        | "Moderation Status"
                        | "Flags"
                        | "Resolved By"
                        | "Marked False By"
                )
            })
            .map(|field| (field.name.clone(), field.value.clone(), field.inline))
            .collect::<Vec<_>>();

        if action == "delete" {
            let user_flag = format!("Message Deleted (by <@{}>)", interaction.user.id);
            let flag = match status {
                "succeeded" | "missing" => user_flag,
                _ => "Delete Failed".to_string(),
            };
            fields.push(("Flags".to_string(), flag, false));
        }

        // Build fresh — CreateEmbed::from() copies existing fields into the builder,
        // and .fields() appends rather than replaces, causing duplication. Match TS
        // EmbedBuilder.from(current).setFields(updatedFields) by starting clean.
        let mut new_embed = serenity::CreateEmbed::new()
            .color(color)
            .fields(fields)
            .timestamp(serenity::Timestamp::now());

        if let Some(ref author) = embed_data.author {
            let mut ea = serenity::CreateEmbedAuthor::new(author.name.clone());
            if let Some(ref icon) = author.icon_url { ea = ea.icon_url(icon); }
            if let Some(ref url) = author.url { ea = ea.url(url); }
            new_embed = new_embed.author(ea);
        }
        if let Some(ref desc) = embed_data.description {
            new_embed = new_embed.description(desc);
        }
        if let Some(ref image) = embed_data.image {
            new_embed = new_embed.image(&image.url);
        }
        if let Some(ref thumbnail) = embed_data.thumbnail {
            new_embed = new_embed.thumbnail(&thumbnail.url);
        }
        if let Some(ref title) = embed_data.title {
            new_embed = new_embed.title(title);
        }
        if let Some(ref url) = embed_data.url {
            new_embed = new_embed.url(url);
        }
        if let Some(footer_text) = footer_text {
            new_embed = new_embed.footer(
                serenity::CreateEmbedFooter::new(footer_text).icon_url(interaction.user.face()),
            );
        }
        embeds.push(new_embed);
    }

    // Build updated components
    let components = if action == "delete" && (status == "missing" || status == "succeeded") {
        // Disable delete button
        disable_delete_button(&interaction.message.components)
    } else {
        vec![]
    };

    let _ = interaction.edit_response(ctx,
        serenity::EditInteractionResponse::new()
            .embeds(embeds)
            .components(components),
    ).await;
}

/// Disable only the delete button while preserving other buttons.
fn disable_delete_button(_rows: &[serenity::ActionRow]) -> Vec<serenity::CreateActionRow> {
    rebuild_action_rows(_rows, "cfb1:del")
}

/// Handle the resolve action.
async fn handle_resolve(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
    message_id_str: &str,
) {
    let _ = interaction.defer(ctx).await;

    let alert = crate::utils::content_filter::get_alert_by_message_id(&data.db, message_id_str)
        .await
        .ok()
        .flatten();
    let alert_id = alert.as_ref().map(|a| a.id.clone());

    if let Some(alert) = alert.as_ref() {
        let new_status = crate::utils::content_filter::handle_alert_mod_status(
            alert.mod_status,
            crate::content_filter::types::ContentFilterStatus::Resolved,
        );
        let _ = crate::utils::content_filter::update_alert_mod_status(
            &data.db,
            &alert.id,
            new_status,
        )
        .await;
    }

    update_submission_message(
        interaction,
        ctx,
        "resolve",
        "handled",
        Some(format!(
            "Resolved by @{} ({})",
            interaction.user.name, interaction.user.id
        )),
    )
    .await;

    let id_text = alert_id.unwrap_or_else(|| "undefined".to_string());
    let _ = interaction.create_followup(ctx,
        serenity::CreateInteractionResponseFollowup::new()
            .content(format!("Successfully resolved alert - ID `{id_text}`"))
            .ephemeral(true),
    ).await;
}

/// Handle the false positive action.
async fn handle_false_positive(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
    channel_id_str: &str,
    message_id_str: &str,
) {
    let _ = interaction.defer(ctx).await;

    let alert = crate::utils::content_filter::get_alert_by_message_id(&data.db, message_id_str)
        .await
        .ok()
        .flatten();
    let alert_id = alert.as_ref().map(|a| a.id.clone());

    if let Some(alert) = alert.as_ref() {
        let new_status = crate::utils::content_filter::handle_alert_mod_status(
            alert.mod_status,
            crate::content_filter::types::ContentFilterStatus::False,
        );
        let _ = crate::utils::content_filter::update_alert_mod_status(
            &data.db,
            &alert.id,
            new_status,
        )
        .await;
    }

    // Feed back to the automated scanner for ML learning.
    crate::content_filter::automated::handle_moderator_feedback(channel_id_str, true);

    update_submission_message(
        interaction,
        ctx,
        "false",
        "handled",
        Some(format!(
            "Marked false-positive by @{} ({})",
            interaction.user.name, interaction.user.id
        )),
    )
    .await;

    let id_text = alert_id.unwrap_or_else(|| "undefined".to_string());
    let _ = interaction.create_followup(ctx,
        serenity::CreateInteractionResponseFollowup::new()
            .content(format!("Successfully marked alert as false positive - ID `{id_text}`"))
            .ephemeral(true),
    ).await;
}

/// Handle viewing the message content.
async fn handle_view_content(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
    message_id_str: &str,
) {
    let _ = interaction.create_response(ctx, serenity::CreateInteractionResponse::Defer(
        serenity::CreateInteractionResponseMessage::new().ephemeral(true),
    )).await;

    let mut embed = serenity::CreateEmbed::new()
        .color(0x3498DB) // Colors.Blue
        .title("Content Filter Details")
        .footer(serenity::CreateEmbedFooter::new(format!("Message ID: {}", message_id_str)))
        .timestamp(serenity::Timestamp::now());

    let mut has_detector_log = false;
    if let Ok(Some(alert)) =
        crate::utils::content_filter::get_alert_by_message_id(&data.db, message_id_str).await
    {
        embed = embed
            .field("Alert ID", &alert.id, true)
            .field("Offender", crate::utils::user_mention_with_id(&alert.offender_id), true)
            .field(
                "Detected By",
                if alert.detectors.is_empty() {
                    "Heuristic".to_string()
                } else {
                    alert
                        .detectors
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(", ")
                },
                true,
            );

        if let Ok(Some(content)) =
            crate::utils::content_filter::get_content_log_by_alert_id(&data.db, &alert.id).await
        {
            let segments = content
                .split("\n---\n")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();

            let preview = segments.first().copied().unwrap_or(content.as_str());
            let summary = if !segments.is_empty() {
                segments
                    .iter()
                    .take(4)
                    .enumerate()
                    .map(|(idx, segment)| format!("{}. {}", idx + 1, truncate_inline(segment, 120)))
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                "No detector segments recorded.".to_string()
            };

            let summary_value = if summary.len() > 1024 {
                format!("{}...", summary.chars().take(1021).collect::<String>())
            } else {
                summary
            };

            let preview_block = truncate_block(preview, 900);
            let safe_preview_raw = preview_block.replace("```", "'''");
            let safe_preview = if safe_preview_raw.is_empty() { "[No content]".to_string() } else { safe_preview_raw };

            embed = embed
                .field("Flagged Segments", summary_value, false)
                .field("Preview", format!("```txt\n{}\n```", safe_preview), false);

            if content.len() > 900 {
                if let Some(url) = crate::utils::hastebin(&content, "txt").await {
                    embed = embed.field("Full Content", format!("[Open full detector content]({url})"), false);
                }
            }

            has_detector_log = true;
        }
    }

    if has_detector_log {
        // TS: deferReply → editReply edits the deferred message in place (one message).
        // Rust must use edit_response, not create_followup, to match that behaviour.
        let _ = interaction.edit_response(ctx,
            serenity::EditInteractionResponse::new().embed(embed),
        ).await;
        return;
    }

    // Fallback to message content from cache or the Message table.
    if let Some(msg) = data.message_manager.get(&data.db, message_id_str).await {
        let content = msg.content.clone().unwrap_or_default();
        if !content.is_empty() {
            let preview = truncate_block(&content, 900);
            let safe_raw = preview.replace("```", "'''");
            let safe_content = if safe_raw.is_empty() { "[No content]".to_string() } else { safe_raw };
            embed = embed.field("Stored Message Content", format!("```txt\n{safe_content}\n```"), false);

            if content.len() > 900 {
                if let Some(url) = crate::utils::hastebin(&content, "txt").await {
                    embed = embed.field("Full Content", format!("[Open full message content]({url})"), false);
                }
            }
        }

        // Show attachment URLs when there is no text content (image-only messages).
        if !msg.attachments.is_empty() {
            let attachment_list = msg.attachments.iter()
                .enumerate()
                .map(|(i, url)| format!("{}. {}", i + 1, url))
                .collect::<Vec<_>>()
                .join("\n");
            let truncated = truncate_block(&attachment_list, 1024);
            embed = embed.field("Attachments", truncated, false);

            // Set embed image to first attachment so moderators can preview it inline.
            if let Some(first_url) = msg.attachments.first() {
                embed = embed.image(first_url);
            }
        }

        if content.is_empty() && msg.attachments.is_empty() {
            embed = embed.field("Stored Message Content", "[No text content]", false);
        }
    } else {
        cf_error_edit(ctx, interaction, "Could not find the message content in the database.").await;
        return;
    }

    let _ = interaction.edit_response(ctx,
        serenity::EditInteractionResponse::new().embed(embed),
    ).await;
}

fn rebuild_action_rows(
    rows: &[serenity::ActionRow],
    disabled_prefix: &str,
) -> Vec<serenity::CreateActionRow> {
    let mut rebuilt = Vec::new();

    for row in rows {
        let mut buttons = Vec::new();

        for component in &row.components {
            if let serenity::ActionRowComponent::Button(button) = component {
                if let Some(created) = rebuild_button(button, disabled_prefix) {
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
    disabled_prefix: &str,
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

            let disabled = custom_id.starts_with(disabled_prefix) || button.disabled;
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

/// Mirrors TS `truncateInline`: normalize whitespace, then truncate to `max` chars with `"..."`.
fn truncate_inline(value: &str, max: usize) -> String {
    use regex::Regex;
    let normalized = Regex::new(r"\s+")
        .map(|ws| ws.replace_all(value, " ").trim().to_string())
        .unwrap_or_else(|_| value.trim().to_string());
    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() <= max {
        return normalized;
    }
    let cropped: String = chars[..max.saturating_sub(3)].iter().collect();
    format!("{cropped}...")
}

/// Mirrors TS `truncateBlock`: plain char-count truncation with `"..."`.
fn truncate_block(value: &str, max: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= max {
        return value.to_string();
    }
    let cropped: String = chars[..max.saturating_sub(3)].iter().collect();
    format!("{cropped}...")
}

async fn cf_error_edit(ctx: &serenity::Context, interaction: &serenity::ComponentInteraction, msg: &str) {
    if interaction.edit_response(ctx,
        serenity::EditInteractionResponse::new()
            .embed(serenity::CreateEmbed::new().description(msg).color(0xED4245u32)),
    ).await.is_ok() {
        let http = ctx.http.clone();
        let token = interaction.token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(7500)).await;
            let _ = http.delete_original_interaction_response(&token).await;
        });
    }
}
