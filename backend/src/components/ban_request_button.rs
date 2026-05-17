use poise::serenity_prelude as serenity;
use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveModelTrait, EntityTrait, Set};
use tracing::{error, warn};
use urlencoding::encode;

use crate::Data;
use crate::lib::config::schema::{LoggingEvent, UserPermission};
use crate::utils::interaction as ia;

/// Handles ban request button clicks (accept/deny/disregard).
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

    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;

    if config.parse_ban_requests_config().is_none() {
        ia::respond_error(
            ctx,
            interaction,
            "Ban requests have not been configured on this server.",
        )
        .await;
        return;
    }

    // Check permissions.
    let Some(member) = interaction.member.as_ref() else {
        ia::respond_error(ctx, interaction, "Failed to resolve executor member.").await;
        return;
    };
    if !config.has_permission(member, UserPermission::ReviewBanRequests) {
        ia::respond_error(
            ctx,
            interaction,
            "You don't have permission to review ban requests.",
        )
        .await;
        return;
    }

    let action = if custom_id == "ban-request-accept" {
        "accept"
    } else if custom_id == "ban-request-deny" {
        "deny"
    } else if custom_id == "ban-request-disregard" {
        "disregard"
    } else {
        ia::respond_error(ctx, interaction, "Unsupported ban request action.").await;
        return;
    };

    // For deny action with enforce_deny_reason, show a modal.
    if action == "deny" && config.data.ban_requests.enforce_deny_reason {
        let modal = serenity::CreateModal::new(
            format!("ban-request-deny-{}", interaction.message.id),
            "Deny Ban Request",
        )
        .components(vec![serenity::CreateActionRow::InputText(
            serenity::CreateInputText::new(serenity::InputTextStyle::Paragraph, "Reason", "reason")
                .required(true)
                .max_length(1024)
                .min_length(1),
        )]);

        let _ = interaction
            .create_response(ctx, serenity::CreateInteractionResponse::Modal(modal))
            .await;
        return;
    }

    // Acknowledge with an ephemeral deferred reply for non-modal actions.
    let _ = interaction.defer_ephemeral(ctx).await;

    process_ban_request(ctx, interaction, data, &config, action, None).await;
}

/// Processes a ban request action (accept/deny/disregard).
pub async fn process_ban_request(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
    config: &crate::lib::config::guild::GuildConfig,
    action: &str,
    review_reason: Option<&str>,
) {
    let message_id = interaction.message.id.to_string();
    let guild_id = match interaction.guild_id {
        Some(id) => id,
        None => return,
    };

    // Fetch ban request.
    let request = match crate::lib::entities::ban_request::Entity::find_by_id(message_id.clone())
        .one(&data.db)
        .await
    {
        Ok(Some(r)) => r,
        _ => {
            let _ = interaction.message.delete(ctx).await;
            ia::followup_error(
                ctx,
                interaction,
                "Ban request could not be found. It may have been deleted.",
            )
            .await;
            return;
        }
    };

    let target_id = request.target_id.clone();
    let resolved_by = request.resolved_by.clone();
    let resolved_at = request.resolved_at; // Option<NaiveDateTime>
    let reason = request.reason.clone();
    let target_muted = request.target_muted_automatically;

    if let Some(resolved_by) = resolved_by {
        let _ = interaction.message.delete(ctx).await;
        let when = resolved_at
            .map(|dt| format!("<t:{}:F>", dt.and_utc().timestamp()))
            .unwrap_or_else(|| "an unknown time".to_string());
        ia::followup_error(
            ctx,
            interaction,
            &format!(
                "This request was resolved by {} on {}.",
                crate::utils::user_mention_with_id(&resolved_by),
                when
            ),
        )
        .await;
        return;
    }

    match action {
        "disregard" => {
            // If target was auto-muted, remove timeout.
            if target_muted {
                if let Ok(target_user_id) = target_id.parse::<u64>() {
                    if let Ok(mut member) = guild_id
                        .member(ctx, serenity::UserId::new(target_user_id))
                        .await
                    {
                        let reason = format!(
                            "Automatic unmute after ban request disregard - ID {}",
                            message_id
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
            active.status = Set(crate::lib::entities::ban_request::RequestStatus::Disregarded);
            active.resolved_by = Set(Some(interaction.user.id.to_string()));
            active.resolved_at = Set(Some(chrono::Utc::now().naive_utc()));
            active.expires_at = Set(None);
            if let Err(err) = active.update(&data.db).await {
                warn!(request_id = %message_id, action = "disregard", "Failed to update ban request status: {err}");
            }

            // TS starts the reviewed log and deletes the submission message after it resolves,
            // without blocking the database update or component response.
            spawn_review_log_then_delete(ctx, interaction, config, action, review_reason).await;
        }

        "accept" => {
            // Fetch target user.
            let target_user_id = match target_id.parse::<u64>() {
                Ok(id) => serenity::UserId::new(id),
                Err(_) => {
                    ia::followup_error(ctx, interaction, "Failed to parse target user ID.").await;
                    return;
                }
            };

            let target_user = match target_user_id.to_user(ctx).await {
                Ok(u) => u,
                Err(_) => {
                    ia::followup_error(
                        ctx,
                        interaction,
                        "Failed to fetch the target user, cannot proceed with ban.",
                    )
                    .await;
                    return;
                }
            };

            // Check if already banned.
            // get_ban returns Ok(Some(ban)) if banned, Ok(None) if not banned, Err if API error.
            if matches!(
                ctx.http.get_ban(guild_id, target_user_id).await,
                Ok(Some(_))
            ) {
                ia::followup_error(
                    ctx,
                    interaction,
                    "The target user is already banned. Unban them before accepting this request.",
                )
                .await;
                return;
            }

            // Notify target user if configured.
            let mut notification_message: Option<serenity::Message> = None;
            if config.data.ban_requests.notify_target {
                let guild_snapshot = guild_id.to_partial_guild(ctx).await.ok();
                let guild_name = guild_snapshot
                    .as_ref()
                    .map(|g| g.name.clone())
                    .unwrap_or_else(|| guild_id.to_string());
                let guild_icon = guild_snapshot.and_then(|g| g.icon_url());

                let mut author = serenity::CreateEmbedAuthor::new(guild_name.clone());
                if let Some(icon) = guild_icon {
                    author = author.icon_url(icon);
                }

                let notify_embed = serenity::CreateEmbed::new()
                    .color(0xED4245)
                    .author(author)
                    .title(format!("You've been banned from {}", guild_name))
                    .footer(serenity::CreateEmbedFooter::new(format!(
                        "Case ID: #{}",
                        interaction.message.id
                    )))
                    .timestamp(serenity::Timestamp::now());

                let mut notify_embed = notify_embed;
                if !reason.is_empty() && !config.data.ban_requests.disable_reason_field {
                    notify_embed = notify_embed.field("Reason", &reason, false);
                }
                if let Some(ref info) = config.data.ban_requests.additional_info {
                    notify_embed = notify_embed.field("Additional Information", info, false);
                }

                notification_message = target_user
                    .dm(ctx, serenity::CreateMessage::new().embed(notify_embed))
                    .await
                    .ok();
            }

            // Mark as accepted BEFORE banning to avoid GuildBanAdd duplicate.
            let mut active: crate::lib::entities::ban_request::ActiveModel = request.clone().into();
            active.status = Set(crate::lib::entities::ban_request::RequestStatus::Accepted);
            active.resolved_by = Set(Some(interaction.user.id.to_string()));
            active.resolved_at = Set(Some(chrono::Utc::now().naive_utc()));
            if let Err(err) = active.update(&data.db).await {
                warn!(request_id = %message_id, action = "accept", "Failed to mark ban request accepted before ban: {err}");
            }

            // Ban the user.
            let ban_reason = format!(
                "[{}] Ban request accepted by {} ({}) - {}",
                interaction.message.id,
                interaction.user.tag(),
                interaction.user.id,
                reason
            );

            let delete_seconds = config
                .data
                .ban_requests
                .delete_message_seconds
                .unwrap_or(0)
                .max(0) as u32;

            match ban_user_with_seconds(data, guild_id, target_user_id, delete_seconds, &ban_reason)
                .await
            {
                Ok(_) => {
                    // Insert temp ban if has expiry.
                    if let Some(exp) = request.expires_at {
                        let model = crate::lib::entities::temporary_ban::ActiveModel {
                            guild_id: Set(guild_id.to_string()),
                            target_id: Set(target_id.clone()),
                            expires_at: Set(exp),
                        };
                        if let Err(err) = crate::lib::entities::temporary_ban::Entity::insert(model)
                            .on_conflict(
                                OnConflict::columns([
                                    crate::lib::entities::temporary_ban::Column::GuildId,
                                    crate::lib::entities::temporary_ban::Column::TargetId,
                                ])
                                .update_column(
                                    crate::lib::entities::temporary_ban::Column::ExpiresAt,
                                )
                                .to_owned(),
                            )
                            .exec(&data.db)
                            .await
                        {
                            warn!(
                                request_id = %message_id,
                                guild_id = %guild_id,
                                target_id = %target_id,
                                "Failed to persist temporary ban: {err}"
                            );
                        }
                    }

                    // Notify requester.
                    spawn_notify_ban_request_result(ctx, config, action, &request, review_reason)
                        .await;
                }
                Err(e) => {
                    error!("Failed to ban user {}: {e}", target_id);
                    if let Some(notification) = notification_message {
                        let _ = notification.delete(ctx).await;
                    }

                    // Revert the status.
                    let db = data.db.clone();
                    let request_id = message_id.clone();
                    tokio::spawn(async move {
                        let mut active = crate::lib::entities::ban_request::ActiveModel {
                            id: Set(request_id.clone()),
                            ..Default::default()
                        };
                        active.status =
                            Set(crate::lib::entities::ban_request::RequestStatus::Pending);
                        active.resolved_by = Set(None);
                        active.resolved_at = Set(None);
                        if let Err(err) = crate::lib::entities::ban_request::Entity::update(active)
                            .exec(&db)
                            .await
                        {
                            warn!(request_id = %request_id, "Failed to revert ban request status after failed ban: {err}");
                        }
                    });

                    ia::followup_error(
                        ctx,
                        interaction,
                        "Failed to ban the target user. Do I have the necessary permissions?",
                    )
                    .await;
                    return;
                }
            }

            spawn_review_log_then_delete(ctx, interaction, config, action, review_reason).await;
        }

        "deny" => {
            // If target was auto-muted, remove timeout.
            if target_muted {
                if let Ok(target_user_id) = target_id.parse::<u64>() {
                    if let Ok(mut member) = guild_id
                        .member(ctx, serenity::UserId::new(target_user_id))
                        .await
                    {
                        let reason = format!(
                            "Automatic unmute after ban request denial - ID {}",
                            message_id
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

            let mut active: crate::lib::entities::ban_request::ActiveModel = request.clone().into();
            active.status = Set(crate::lib::entities::ban_request::RequestStatus::Denied);
            active.resolved_by = Set(Some(interaction.user.id.to_string()));
            active.resolved_at = Set(Some(chrono::Utc::now().naive_utc()));
            if let Err(err) = active.update(&data.db).await {
                warn!(request_id = %message_id, action = "deny", "Failed to update ban request status: {err}");
            }

            spawn_review_log_then_delete(ctx, interaction, config, action, review_reason).await;
            spawn_notify_ban_request_result(ctx, config, action, &request, review_reason).await;
        }

        _ => {}
    }

    let past_tense = match action {
        "accept" => "accepted",
        "deny" => "denied",
        "disregard" => "disregarded",
        _ => action,
    };

    ia::followup_success(
        ctx,
        interaction,
        &format!(
            "Successfully {} ban request - ID `{}`",
            past_tense, interaction.message.id
        ),
    )
    .await;
}

async fn spawn_review_log_then_delete(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    config: &crate::lib::config::guild::GuildConfig,
    action: &str,
    review_reason: Option<&str>,
) {
    let ctx = ctx.clone();
    let interaction = interaction.clone();
    let config = config.clone();
    let action = action.to_string();
    let review_reason = review_reason.map(str::to_string);

    tokio::spawn(async move {
        log_ban_request_reviewed(
            &ctx,
            &interaction,
            &config,
            &action,
            review_reason.as_deref(),
        )
        .await;
        let _ = interaction.message.delete(&ctx).await;
    });
}

async fn spawn_notify_ban_request_result(
    ctx: &serenity::Context,
    config: &crate::lib::config::guild::GuildConfig,
    action: &str,
    request: &crate::lib::entities::ban_request::Model,
    review_reason: Option<&str>,
) {
    if !config.can_log_event(LoggingEvent::BanRequestResult) {
        return;
    }

    let requested_by = request.requested_by.clone();
    let target_id = request.target_id.clone();
    let ctx = ctx.clone();
    let config = config.clone();
    let action = action.to_string();
    let review_reason = review_reason.map(str::to_string);

    tokio::spawn(async move {
        let past_tense = match action.as_str() {
            "accept" => "accepted",
            "deny" => "denied",
            _ => action.as_str(),
        };

        let reason_suffix = match review_reason.as_deref() {
            Some(r) => format!(" - {}", r.replace('`', "")),
            None => ".".to_string(),
        };

        let content = format!(
            "<@{}>, your ban request against {} has been {}{}",
            requested_by,
            crate::utils::user_mention_with_id(&target_id),
            past_tense,
            reason_suffix,
        );

        config
            .log(
                ctx.http.as_ref(),
                LoggingEvent::BanRequestResult,
                serenity::ExecuteWebhook::new()
                    .content(&content)
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

async fn ban_user_with_seconds(
    data: &Data,
    guild_id: serenity::GuildId,
    target_user_id: serenity::UserId,
    delete_message_seconds: u32,
    reason: &str,
) -> Result<(), String> {
    let url = format!(
        "https://discord.com/api/v10/guilds/{}/bans/{}",
        guild_id.get(),
        target_user_id.get()
    );
    let encoded_reason = encode(reason);

    let response = data
        .http_client
        .put(url)
        .query(&[("delete_message_seconds", delete_message_seconds.to_string())])
        .header("Authorization", format!("Bot {}", data.env.bot_token))
        .header("X-Audit-Log-Reason", encoded_reason.as_ref())
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    if response.status().is_success() {
        return Ok(());
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(format!("discord returned {status}: {body}"))
}

/// Log the ban request review to the configured logging webhook.
async fn log_ban_request_reviewed(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    config: &crate::lib::config::guild::GuildConfig,
    action: &str,
    review_reason: Option<&str>,
) {
    if !config.can_log_event(LoggingEvent::BanRequestReviewed) {
        return;
    }

    let color = match action {
        "accept" => 0x57F287,    // Green
        "deny" => 0xED4245,      // Red
        "disregard" => 0x5865F2, // Blurple
        _ => 0x23272a,           // Colors.NotQuiteBlack (unreachable in practice)
    };

    let past_tense = match action {
        "accept" => "Accepted",
        "deny" => "Denied",
        "disregard" => "Disregarded",
        _ => action,
    };

    if let Some(current_embed) = interaction.message.embeds.first() {
        let mut embed = serenity::CreateEmbed::from(current_embed.clone())
            .color(color)
            .author(serenity::CreateEmbedAuthor::new(format!(
                "Ban Request {}",
                past_tense
            )))
            .footer(
                serenity::CreateEmbedFooter::new(format!(
                    "Reviewed by @{} ({})",
                    interaction.user.name, interaction.user.id
                ))
                .icon_url(interaction.user.face()),
            )
            .timestamp(serenity::Timestamp::now());

        if let Some(reason) = review_reason {
            embed = embed.field("Reviewer Reason", reason, false);
        }

        config
            .log(
                ctx.http.as_ref(),
                LoggingEvent::BanRequestReviewed,
                serenity::ExecuteWebhook::new().embed(embed),
            )
            .await;
    }
}
