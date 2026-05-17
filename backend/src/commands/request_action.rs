use crate::{Context, Error};
use poise::serenity_prelude::{
    self as serenity, ButtonStyle, CreateActionRow, CreateButton, CreateEmbed, CreateEmbedAuthor,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};
use tracing::{error, warn};

/// Send an ephemeral red-embed error response, matching the TS `{ error: "..." }` pattern.
async fn reply_error(ctx: Context<'_>, message: impl Into<String>) -> Result<(), Error> {
    let embed = CreateEmbed::new()
        .description(message.into())
        .color(0xED4245u32); // Colors.Red
    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// Request a moderation action.
///
#[poise::command(
    slash_command,
    guild_only,
    default_member_permissions = "MODERATE_MEMBERS",
    subcommands("ban")
)]
pub async fn request(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Request a ban for a user.
#[poise::command(slash_command, ephemeral)]
pub async fn ban(
    ctx: Context<'_>,
    #[description = "The user to request a ban for"] target: serenity::User,
    #[description = "The duration of the ban (e.g., 1d, 12h)"] duration: Option<String>,
    #[description = "The reason for the ban"]
    #[max_length = 1024]
    reason: Option<String>,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id_str = guild_id.to_string();

    // Get config and check if ban requests are configured.
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;
    if config.parse_ban_requests_config().is_none() {
        return reply_error(ctx, "Ban requests have not been configured on this server.").await;
    }

    ctx.defer_ephemeral().await?;

    let target_id = target.id;
    let executor = ctx.author();
    let bot_user_id = { ctx.cache().current_user().id };
    let executor_member = guild_id.member(ctx, executor.id).await.ok();

    // Check if target is already banned.
    // get_ban returns Ok(Some(ban)) if banned, Ok(None) if not banned, Err if API error.
    let already_banned = matches!(ctx.http().get_ban(guild_id, target_id).await, Ok(Some(_)));
    if already_banned {
        return reply_error(ctx, "The provided target is already banned.").await;
    }

    let target_member = guild_id.member(ctx, target_id).await.ok();

    // Check immune roles.
    {
        let immune_roles = &config.data.ban_requests.immune_roles;
        if !immune_roles.is_empty() {
            if let Some(target_member) = target_member.as_ref() {
                let is_immune = immune_roles
                    .iter()
                    .any(|role| target_member.roles.iter().any(|r| r.to_string() == *role));
                if is_immune {
                    return reply_error(ctx, "The target user is immune to ban requests.").await;
                }
            }
        }
    }

    // Check for existing pending request.
    let pending_exists = crate::lib::entities::ban_request::Entity::find()
        .filter(crate::lib::entities::ban_request::Column::GuildId.eq(guild_id_str.clone()))
        .filter(crate::lib::entities::ban_request::Column::TargetId.eq(target_id.to_string()))
        .filter(
            crate::lib::entities::ban_request::Column::Status
                .eq(crate::lib::entities::ban_request::RequestStatus::Pending),
        )
        .one(&data.db)
        .await?
        .is_some();
    if pending_exists {
        return reply_error(ctx, "There is already a pending ban request for this user.").await;
    }

    // Parse duration.
    let duration_ms = duration
        .as_ref()
        .and_then(|d| crate::utils::parse_duration_string(d));
    if duration.is_some() && duration_ms.is_none() {
        return reply_error(ctx, "The provided duration is invalid. Please provide a valid duration string (e.g., 1d, 12h, 30m).").await;
    }
    if let Some(duration_ms) = duration_ms {
        if let Err(msg) = crate::utils::validate_duration(duration_ms, "1s", "9007199254740991ms") {
            return reply_error(ctx, msg).await;
        }
    }

    let expires_at =
        duration_ms.map(|ms| chrono::Utc::now() + chrono::Duration::milliseconds(ms as i64));

    let (guild_owner_id, guild_roles) = match guild_id.to_guild_cached(ctx.cache()) {
        Some(guild) => (Some(guild.owner_id), Some(guild.roles.clone())),
        None => (None, None),
    };
    let bot_member = guild_id.member(ctx, bot_user_id).await.ok();
    if let Some(executor_member) = executor_member.as_ref() {
        let validation = crate::utils::moderation::validate_action(
            target_id,
            target_member.as_ref(),
            executor_member,
            bot_user_id,
            "Ban",
            guild_owner_id,
            bot_member.as_ref(),
            guild_roles.as_ref(),
        );
        if !validation.ok {
            return reply_error(
                ctx,
                validation
                    .message
                    .unwrap_or_else(|| "Action not allowed.".to_string()),
            )
            .await;
        }
    }

    // Check if reason is required.
    if reason.is_none() && config.data.ban_requests.enforce_submission_reason {
        return reply_error(
            ctx,
            "A reason is required to submit a ban request in this server.",
        )
        .await;
    }

    let reason_str = reason.as_deref().unwrap_or("No reason provided");

    // Build embed.
    let mut embed_fields = vec![
        (
            "Target".to_string(),
            crate::utils::user_mention_with_id(&target_id.to_string()),
            false,
        ),
        (
            "Requested By".to_string(),
            crate::utils::user_mention_with_id(&executor.id.to_string()),
            false,
        ),
    ];

    if let Some(ms) = duration_ms {
        embed_fields.insert(
            2,
            (
                "Duration".to_string(),
                crate::utils::format_duration_ms(ms),
                false,
            ),
        );
    }

    embed_fields.push(("Reason".to_string(), reason_str.to_string(), false));

    // Send webhook message.
    let Some(webhook_url) = config.data.ban_requests.webhook_url.as_ref() else {
        return reply_error(ctx, "Ban requests have not been configured on this server.").await;
    };
    let webhook = serenity::Webhook::from_url(ctx, webhook_url).await?;

    let notify_content = {
        let roles = &config.data.ban_requests.notify_roles;
        if roles.is_empty() {
            None
        } else {
            Some(
                roles
                    .iter()
                    .map(|r| {
                        if r == "here" {
                            "@here".to_string()
                        } else {
                            format!("<@&{r}>")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        }
    };

    let embed = CreateEmbed::new()
        .color(0x3498DB) // Colors.Blue
        .author(CreateEmbedAuthor::new("New Ban Request"))
        .thumbnail(target.face())
        .fields(embed_fields)
        .timestamp(serenity::Timestamp::now());

    let accept_btn = CreateButton::new("ban-request-accept")
        .label("Accept")
        .style(ButtonStyle::Success);
    let deny_btn = CreateButton::new("ban-request-deny")
        .label("Deny")
        .style(ButtonStyle::Danger);
    let disregard_btn = CreateButton::new("ban-request-disregard")
        .label("Disregard")
        .style(ButtonStyle::Primary);
    let info_btn = CreateButton::new(format!("user-info-{}", target_id))
        .label("User Info")
        .style(ButtonStyle::Secondary);

    let action_row = CreateActionRow::Buttons(vec![accept_btn, deny_btn, disregard_btn, info_btn]);

    let mut builder = serenity::ExecuteWebhook::new()
        .embed(embed)
        .components(vec![action_row])
        .allowed_mentions(
            serenity::CreateAllowedMentions::new()
                .all_roles(true)
                .everyone(false)
                .all_users(false),
        );

    if let Some(ref content) = notify_content {
        builder = builder.content(content);
    }

    let log_msg = match webhook.execute(ctx, true, builder).await {
        Ok(Some(message)) => message,
        _ => {
            return reply_error(ctx, "Failed to submit ban request.").await;
        }
    };

    // Auto-timeout if configured.
    let mut muted = false;
    if config.data.ban_requests.automatically_timeout {
        match target_member {
            None => {
                warn!(
                    request_id = %log_msg.id,
                    target_id = %target_id,
                    "Auto-timeout skipped: target is not a guild member"
                );
            }
            Some(mut target_member) => {
                // Subtract 60 seconds to stay safely under Discord's 28-day hard cap
                // regardless of clock skew between this host and Discord's servers.
                let timeout_until =
                    chrono::Utc::now() + chrono::Duration::days(28) - chrono::Duration::seconds(60);
                let reason = format!("Automatic timeout for ban request - ID {}", log_msg.id);
                match target_member
                    .edit(
                        ctx.serenity_context(),
                        serenity::EditMember::new()
                            .disable_communication_until_datetime(serenity::Timestamp::from(
                                timeout_until,
                            ))
                            .audit_log_reason(&reason),
                    )
                    .await
                {
                    Ok(_) => muted = true,
                    Err(e) => error!(
                        request_id = %log_msg.id,
                        target_id = %target_id,
                        "Auto-timeout failed for ban request: {e}"
                    ),
                }
            }
        }
    }

    // Insert into database.
    let model = crate::lib::entities::ban_request::ActiveModel {
        id: Set(log_msg.id.to_string()),
        guild_id: Set(guild_id_str),
        target_id: Set(target_id.to_string()),
        target_muted_automatically: Set(muted),
        requested_by: Set(executor.id.to_string()),
        reason: Set(reason_str.to_string()),
        expires_at: Set(expires_at.map(|dt| dt.naive_utc())),
        ..Default::default()
    };
    crate::lib::entities::ban_request::Entity::insert(model)
        .exec(&data.db)
        .await?;

    ctx.say(format!(
        "Successfully submitted a ban request for <@{}> - ID `{}`.",
        target.id, log_msg.id
    ))
    .await?;
    Ok(())
}
