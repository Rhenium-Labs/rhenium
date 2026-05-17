use poise::serenity_prelude as serenity;
use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use tracing::warn;

use crate::config::schema::{LoggingEvent, UserPermission};
use crate::Data;
use crate::utils::interaction as ia;

/// Handles message report button clicks (resolve/disregard).
///
pub async fn handle(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
) {
    let custom_id = &interaction.data.custom_id;
    let guild_id = match interaction.guild_id {
        Some(id) => id,
        None => return,
    };

    let config = data.config_manager.get_guild_config(&data.db, guild_id).await;
    if config.parse_reports_config().is_none() {
        ia::respond_error(ctx, interaction, "Message reports have not been configured on this server.").await;
        return;
    }

    let (status, past_tense, color) = if custom_id == "message-report-resolve" {
        ("Resolved", "resolved", 0x57F287u32)
    } else if custom_id == "message-report-disregard" {
        ("Disregarded", "disregarded", 0x5865F2u32)
    } else {
        ia::respond_error(ctx, interaction, "Unsupported message report action.").await;
        return;
    };

    let _ = interaction.defer(ctx).await;

    let Some(member) = interaction.member.as_ref() else {
        ia::followup_error(ctx, interaction, "Failed to resolve executor member.").await;
        return;
    };
    if !config.has_permission(member, UserPermission::ReviewMessageReports) {
        ia::followup_error(ctx, interaction, "You don't have permission to review message reports").await;
        return;
    }

    let report_id = interaction.message.id.to_string();
    let report_row = crate::entities::message_report::Entity::find_by_id(report_id.clone())
        .one(&data.db)
        .await
        .ok()
        .flatten();
    let Some(report_row) = report_row else {
        let _ = interaction.message.delete(ctx).await;
        ia::followup_error(ctx, interaction, "Message report could not be found. It may have already been deleted.").await;
        return;
    };

    let resolved_by = report_row.resolved_by.clone();
    let resolved_at = report_row.resolved_at;
    if let Some(resolved_by) = resolved_by {
        let _ = interaction.message.delete(ctx).await;
        let when = resolved_at
            .map(|dt| format!("<t:{}:F>", dt.and_utc().timestamp()))
            .unwrap_or_else(|| "an unknown time".to_string());
        ia::followup_error(ctx, interaction, &format!(
            "This report was resolved by {} on {}.",
            crate::utils::user_mention_with_id(&resolved_by), when
        )).await;
        return;
    }

    let reviewed_embeds = build_reviewed_embeds(interaction, status, color);
    let review_log_links = if config.can_log_event(LoggingEvent::MessageReportReviewed) {
        match reviewed_embeds.as_ref() {
            Some(embeds) => {
                send_review_log_links(ctx, &config, guild_id, embeds, LoggingEvent::MessageReportReviewed).await
            }
            None => Vec::new(),
        }
    } else {
        Vec::new()
    };

    if config.data.message_reports.delete_submission_on_handle {
        let ctx_clone = ctx.clone();
        let message = interaction.message.clone();
        tokio::spawn(async move {
            let _ = message.delete(&ctx_clone).await;
        });
    } else if let Some(embeds) = reviewed_embeds {
        let ctx_clone = ctx.clone();
        let interaction_clone = interaction.clone();
        tokio::spawn(async move {
            let _ = interaction_clone
                .edit_response(
                    &ctx_clone,
                    serenity::EditInteractionResponse::new()
                        .embeds(embeds)
                        .components(vec![]),
                )
                .await;
        });
    }

    let new_status = if custom_id == "message-report-resolve" {
        crate::entities::message_report::ReportStatus::Resolved
    } else {
        crate::entities::message_report::ReportStatus::Disregarded
    };
    let mut active: crate::entities::message_report::ActiveModel = report_row.into();
    active.status = Set(new_status);
    active.resolved_by = Set(Some(interaction.user.id.to_string()));
    active.resolved_at = Set(Some(chrono::Utc::now().naive_utc()));
    if let Err(err) = active.update(&data.db).await {
        warn!(report_id, "Failed to update message report status: {err}");
    }

    let formatted_logs = if review_log_links.is_empty() {
        String::new()
    } else {
        format!("\n └ {}", review_log_links.join(", "))
    };

    ia::followup_success(ctx, interaction, &format!(
        "Successfully {} report - ID `{}`{}",
        past_tense, interaction.message.id, formatted_logs
    )).await;
}

fn build_reviewed_embeds(
    interaction: &serenity::ComponentInteraction,
    status: &str,
    color: u32,
) -> Option<Vec<serenity::CreateEmbed>> {
    let embed_idx = if interaction.message.embeds.len() > 1 { 1 } else { 0 };
    let current_embed = interaction.message.embeds.get(embed_idx)?;

    let reviewed_embed = serenity::CreateEmbed::from(current_embed.clone())
        .color(color)
        .author(serenity::CreateEmbedAuthor::new(format!(
            "Message Report {}",
            status
        )))
        .footer(
            serenity::CreateEmbedFooter::new(format!(
                "{} by @{} ({})",
                status, interaction.user.name, interaction.user.id
            ))
            .icon_url(interaction.user.face()),
        )
        .timestamp(serenity::Timestamp::now());

    if embed_idx == 1 {
        Some(vec![
            serenity::CreateEmbed::from(interaction.message.embeds[0].clone()),
            reviewed_embed,
        ])
    } else {
        Some(vec![reviewed_embed])
    }
}

async fn send_review_log_links(
    ctx: &serenity::Context,
    config: &crate::config::guild::GuildConfig,
    guild_id: serenity::GuildId,
    embeds: &[serenity::CreateEmbed],
    event: LoggingEvent,
) -> Vec<String> {
    let mut links = Vec::new();

    for wh in &config.data.logging_webhooks {
        if !wh.events.contains(&event) {
            continue;
        }

        let webhook_id = match wh.id.parse::<u64>() {
            Ok(id) => id,
            Err(_) => continue,
        };

        let webhook = match serenity::Webhook::from_id_with_token(
            ctx.http.as_ref(),
            serenity::WebhookId::new(webhook_id),
            &wh.token,
        )
        .await
        {
            Ok(webhook) => webhook,
            Err(_) => continue,
        };

        let payload = serenity::ExecuteWebhook::new().embeds(embeds.to_vec());
        let logged_message = match webhook.execute(ctx.http.as_ref(), true, payload).await {
            Ok(Some(message)) => message,
            _ => continue,
        };

        links.push(format!(
            "https://discord.com/channels/{}/{}/{}",
            guild_id, logged_message.channel_id, logged_message.id
        ));
    }

    links
}
