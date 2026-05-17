use poise::serenity_prelude as serenity;
use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use tracing::warn;

use crate::Data;
use crate::lib::config::schema::UserPermission;
use crate::utils::interaction as ia;

/// Handles ban request deny modal submissions.
///
pub async fn handle(
    ctx: &serenity::Context,
    modal: &serenity::ModalInteraction,
    data: &Data,
) {
    let guild_id = match modal.guild_id {
        Some(id) => id,
        None => return,
    };

    let config = data.config_manager.get_guild_config(&data.db, guild_id).await;

    if config.parse_ban_requests_config().is_none() {
        ia::modal_respond_error(ctx, modal, "Ban requests have not been configured on this server.").await;
        return;
    }

    // Check permissions.
    let Some(member) = modal.member.as_ref() else {
        ia::modal_respond_error(ctx, modal, "Failed to resolve executor member.").await;
        return;
    };
    if !config.has_permission(member, UserPermission::ReviewBanRequests) {
        ia::modal_respond_error(ctx, modal, "You don't have permission to review ban requests.").await;
        return;
    }

    let _ = modal
        .create_response(
            ctx,
            serenity::CreateInteractionResponse::Defer(
                serenity::CreateInteractionResponseMessage::new().ephemeral(true),
            ),
        )
        .await;

    // Get the reason from the modal.
    let review_reason = modal
        .data
        .components
        .first()
        .and_then(|row| row.components.first())
        .and_then(|c| match c {
            serenity::ActionRowComponent::InputText(input) => input.value.clone(),
            _ => None,
        });

    // Parse the request ID from the custom_id: "ban-request-deny-{message_id}"
    let request_id = modal.data.custom_id
        .strip_prefix("ban-request-deny-")
        .unwrap_or("")
        .to_string();
    if request_id.is_empty() {
        ia::modal_followup_error(ctx, modal, "Failed to parse deny request payload.").await;
        return;
    }

    // Fetch the ban request.
    let request = match crate::lib::entities::ban_request::Entity::find_by_id(request_id.clone())
        .one(&data.db)
        .await
    {
        Ok(Some(r)) => r,
        _ => {
            if let Some(ref message) = modal.message {
                let _ = message.delete(ctx).await;
            }
            ia::modal_followup_error(ctx, modal, "Ban request could not be found. It may have been deleted.").await;
            return;
        }
    };

    if let Some(ref resolved_by) = request.resolved_by {
        if let Some(ref message) = modal.message {
            let _ = message.delete(ctx).await;
        }
        let when = request.resolved_at
            .map(|dt| format!("<t:{}:F>", dt.and_utc().timestamp()))
            .unwrap_or_else(|| "an unknown time".to_string());
        ia::modal_followup_error(ctx, modal, &format!(
            "This request was resolved by {} on {}.",
            crate::utils::user_mention_with_id(resolved_by), when
        )).await;
        return;
    }

    let target_id = request.target_id.clone();
    let target_muted = request.target_muted_automatically;

    // If target was auto-muted, remove timeout.
    if target_muted {
        if let Ok(target_user_id) = target_id.parse::<u64>() {
            if let Ok(mut member) = guild_id.member(ctx, serenity::UserId::new(target_user_id)).await {
                let reason = format!(
                    "Automatic unmute after ban request denial - ID {}",
                    request_id
                );
                let _ = member
                    .edit(
                        ctx,
                        serenity::EditMember::new()
                            .enable_communication()
                            .audit_log_reason(&reason),
                    )
                    .await;
            }
        }
    }

    // Update DB.
    let mut active: crate::lib::entities::ban_request::ActiveModel = request.clone().into();
    active.status = Set(crate::lib::entities::ban_request::RequestStatus::Denied);
    active.resolved_by = Set(Some(modal.user.id.to_string()));
    active.resolved_at = Set(Some(chrono::Utc::now().naive_utc()));
    if let Err(err) = active.update(&data.db).await {
        warn!(request_id, action = "deny", "Failed to update ban request status from deny modal: {err}");
    }

    if let Some(ref message) = modal.message {
        let ctx = ctx.clone();
        let config = config.clone();
        let modal = modal.clone();
        let message = message.clone();
        let review_reason = review_reason.clone();
        tokio::spawn(async move {
            if config.can_log_event(crate::lib::config::schema::LoggingEvent::BanRequestReviewed) {
                if let Some(current_embed) = message.embeds.first() {
                    let mut embed = serenity::CreateEmbed::from(current_embed.clone())
                        .color(0xED4245)
                        .author(serenity::CreateEmbedAuthor::new("Ban Request Denied"))
                        .footer(
                            serenity::CreateEmbedFooter::new(format!(
                                "Reviewed by @{} ({})",
                                modal.user.name, modal.user.id
                            ))
                            .icon_url(modal.user.face()),
                        )
                        .timestamp(serenity::Timestamp::now());

                    if let Some(reason) = review_reason.as_deref() {
                        embed = embed.field("Reviewer Reason", reason, false);
                    }

                    config
                        .log(
                            ctx.http.as_ref(),
                            crate::lib::config::schema::LoggingEvent::BanRequestReviewed,
                            serenity::ExecuteWebhook::new().embed(embed),
                        )
                        .await;
                }
            }

            let _ = message.delete(&ctx).await;
        });
    }

    if config.can_log_event(crate::lib::config::schema::LoggingEvent::BanRequestResult) {
        let requested_by = request.requested_by.clone();
        let reason_suffix = review_reason
            .as_deref()
            .map(|r| format!(" - {}", r.replace('`', "")))
            .unwrap_or_else(|| ".".to_string());
        let content = format!(
            "<@{}>, your ban request against {} has been denied{}",
            requested_by,
            crate::utils::user_mention_with_id(&target_id),
            reason_suffix,
        );
        let ctx = ctx.clone();
        let config = config.clone();
        tokio::spawn(async move {
            config
                .log(
                    ctx.http.as_ref(),
                    crate::lib::config::schema::LoggingEvent::BanRequestResult,
                    serenity::ExecuteWebhook::new()
                        .content(content)
                        .allowed_mentions(
                            requested_by
                                .parse::<u64>()
                                .ok()
                                .map(serenity::UserId::new)
                                .map(|id| serenity::CreateAllowedMentions::new().users(vec![id]))
                                .unwrap_or_else(serenity::CreateAllowedMentions::new),
                        ),
                )
                .await;
        });
    }

    ia::modal_followup_success(ctx, modal, &format!("Successfully denied ban request - ID `{}`", request_id)).await;
}

