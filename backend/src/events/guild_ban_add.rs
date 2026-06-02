use poise::serenity_prelude as serenity;
use sea_orm::sea_query::{Alias, Expr};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use tracing::{error, info};

use crate::Data;
use crate::lib::config::schema::LoggingEvent;

/// Maximum age for Discord bulk delete in milliseconds (14 days).
const BULK_DELETE_MAX_AGE_MS: i64 = 14 * 24 * 60 * 60 * 1000;
/// Bulk delete batch size limit.
const BULK_DELETE_LIMIT: usize = 100;
/// Discord epoch: 2015-01-01T00:00:00.000Z.
const DISCORD_EPOCH: i64 = 1_420_070_400_000;

/// Handles the GuildBanAdd event.
///
/// - Auto-resolves pending message reports for the banned user.
/// - Auto-resolves pending ban requests for the banned user.
/// - Logs resolved items to the configured webhook.
pub async fn handle(
    ctx: &serenity::Context,
    guild_id: &serenity::GuildId,
    banned_user: &serenity::User,
    data: &Data,
) {
    let guild_id_str = guild_id.to_string();
    let user_id_str = banned_user.id.to_string();
    let config = data
        .config_manager
        .get_guild_config(&data.db, *guild_id)
        .await;

    // Run both resolve tasks in parallel.
    let (reports_result, requests_result) = tokio::join!(
        resolve_pending_reports(ctx, &config, &guild_id_str, &user_id_str, banned_user, data),
        resolve_pending_ban_requests(ctx, &config, &guild_id_str, &user_id_str, banned_user, data),
    );

    if let Err(e) = reports_result {
        error!(
            "Failed to resolve pending reports for {} in {}: {e}",
            user_id_str, guild_id_str
        );
    }
    if let Err(e) = requests_result {
        error!(
            "Failed to resolve pending ban requests for {} in {}: {e}",
            user_id_str, guild_id_str
        );
    }
}

/// Resolves pending message reports for a banned user.
async fn resolve_pending_reports(
    ctx: &serenity::Context,
    config: &crate::lib::config::guild::GuildConfig,
    guild_id: &str,
    user_id: &str,
    banned_user: &serenity::User,
    data: &Data,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let reports_config = match config.parse_reports_config() {
        Some(cfg) => cfg,
        None => return Ok(()),
    };

    let (bot_id, bot_name, bot_avatar_url) = {
        let bot_user = ctx.cache.current_user();
        (
            bot_user.id.to_string(),
            bot_user.name.clone(),
            bot_user.face(),
        )
    };

    use crate::lib::entities::message_report::{Column as MRCol, Entity as MREntity, ReportStatus};

    // Select pending reports first, then bulk-update, so we have the data for logging.
    let results = MREntity::find()
        .filter(MRCol::AuthorId.eq(user_id))
        .filter(MRCol::GuildId.eq(guild_id))
        .filter(MRCol::Status.eq(ReportStatus::Pending))
        .all(&data.db)
        .await?;

    if results.is_empty() {
        return Ok(());
    }

    MREntity::update_many()
        .col_expr(
            MRCol::Status,
            Expr::value(ReportStatus::AutoResolved).cast_as(Alias::new("\"ReportStatus\"")),
        )
        .col_expr(MRCol::ResolvedBy, Expr::value(bot_id.clone()))
        .col_expr(
            MRCol::ResolvedAt,
            Expr::value(chrono::Utc::now().naive_utc()),
        )
        .filter(MRCol::AuthorId.eq(user_id))
        .filter(MRCol::GuildId.eq(guild_id))
        .filter(MRCol::Status.eq(ReportStatus::Pending))
        .exec(&data.db)
        .await?;

    let mut rendered_reports: Vec<(String, Vec<serenity::CreateEmbed>)> =
        Vec::with_capacity(results.len());
    for report in &results {
        let report_id = report.id.clone();
        let reported_by = report.reported_by.clone();
        let report_reason = report.report_reason.clone();
        let content = report.content.clone();
        let message_url = Some(report.message_url.clone());
        let additional_reporters = report.additional_reporters.clone();
        let reference_id = report.reference_id.clone();
        let reported_at = Some(report.reported_at.and_utc());

        let cropped_content = crate::utils::crop_lines(
            content
                .as_deref()
                .unwrap_or(crate::utils::constants::EMPTY_MESSAGE_CONTENT),
            5,
        );
        let formatted_content = crate::utils::messages::format_message_content(
            ctx.http.clone(),
            crate::utils::messages::FormatMessageContentData {
                url: message_url.as_deref(),
                content: Some(&cropped_content),
                sticker_id: None,
                author_id: None,
                created_at: reported_at.map(|ts| ts.timestamp()),
                include_url: true,
            },
        )
        .await;

        // TS joins additional reporters with "\n" but does NOT add a leading
        // "\n" before them — the field value is `${primary}${additionalJoined}`.
        // So when there are additional reporters the value looks like:
        //   "<@primary><@id1>\n<@id2>"  (no newline before the first extra)
        let additional = if additional_reporters.is_empty() {
            String::new()
        } else {
            additional_reporters
                .iter()
                .map(|id| crate::utils::user_mention_with_id(id))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let mut embeds = vec![
            serenity::CreateEmbed::new()
                .author(serenity::CreateEmbedAuthor::new(
                    "Message Report AutoResolved",
                ))
                .color(0x57F287) // Green
                .thumbnail(banned_user.face())
                .fields(vec![
                    (
                        "Reported By",
                        format!(
                            "{}{}",
                            crate::utils::user_mention_with_id(&reported_by),
                            additional
                        ),
                        false,
                    ),
                    ("Report Reason", report_reason, false),
                    (
                        "Message Author",
                        crate::utils::user_mention_with_id(user_id),
                        false,
                    ),
                    ("Message Content", formatted_content, false),
                ])
                .footer(
                    serenity::CreateEmbedFooter::new(format!(
                        "Reviewed by @{} ({})",
                        bot_name, bot_id
                    ))
                    .icon_url(bot_avatar_url.clone()),
                )
                .timestamp(serenity::Timestamp::now()),
        ];

        if let Some(reference_id) = reference_id {
            if let Some(reference) = data.message_manager.get(&data.db, &reference_id).await {
                let reference_url = format!(
                    "https://discord.com/channels/{}/{}/{}",
                    reference.guild_id, reference.channel_id, reference.id
                );
                let cropped_reference = crate::utils::crop_lines(
                    reference
                        .content
                        .as_deref()
                        .unwrap_or(crate::utils::constants::EMPTY_MESSAGE_CONTENT),
                    5,
                );
                let formatted_reference = crate::utils::messages::format_message_content(
                    ctx.http.clone(),
                    crate::utils::messages::FormatMessageContentData {
                        url: Some(&reference_url),
                        content: Some(&cropped_reference),
                        sticker_id: reference.sticker_id.as_deref(),
                        author_id: None,
                        created_at: Some(reference.created_at.timestamp()),
                        include_url: true,
                    },
                )
                .await;

                embeds.push(
                    serenity::CreateEmbed::new()
                        .author(serenity::CreateEmbedAuthor::new("Message Reference"))
                        .color(0x23272a) // Colors.NotQuiteBlack
                        .fields(vec![
                            (
                                "Reference Author",
                                crate::utils::user_mention_with_id(&reference.author_id),
                                false,
                            ),
                            ("Reference Content", formatted_reference, false),
                        ])
                        .timestamp(serenity::Timestamp::now()),
                );
            }
        }

        rendered_reports.push((report_id, embeds));
    }

    for (_, embeds) in &rendered_reports {
        config
            .log(
                ctx.http.as_ref(),
                LoggingEvent::MessageReportReviewed,
                serenity::ExecuteWebhook::new().embeds(embeds.clone()),
            )
            .await;
    }

    if !reports_config.delete_submission_on_handle {
        if let Some(webhook_url) = reports_config.webhook_url.as_ref() {
            if let Ok(webhook) = serenity::Webhook::from_url(ctx, webhook_url).await {
                for (report_id, embeds) in rendered_reports {
                    if let Ok(message_id) = report_id.parse::<u64>() {
                        let _ = webhook
                            .edit_message(
                                ctx,
                                serenity::MessageId::new(message_id),
                                serenity::EditWebhookMessage::new()
                                    .embeds(embeds)
                                    .components(vec![]),
                            )
                            .await;
                    }
                }
            }
        }

        info!(
            "Auto-resolved {} pending reports for {} in guild {}",
            results.len(),
            user_id,
            guild_id
        );
        return Ok(());
    }

    // If configured, bulk-delete the report submissions from the webhook channel.
    if let Some(ref channel_id_str) = reports_config.webhook_channel {
        if let Ok(channel_id) = channel_id_str.parse::<u64>() {
            let channel = serenity::ChannelId::new(channel_id);
            let msg_ids: Vec<serenity::MessageId> = results
                .iter()
                .filter_map(|r| r.id.parse::<u64>().ok().map(serenity::MessageId::new))
                .collect();

            if !msg_ids.is_empty() {
                delete_submission_messages(ctx, channel, &msg_ids).await;
            }
        }
    }

    info!(
        "Auto-resolved {} pending reports for {} in guild {}",
        results.len(),
        user_id,
        guild_id
    );
    Ok(())
}

/// Resolves pending ban requests for a banned user.
async fn resolve_pending_ban_requests(
    ctx: &serenity::Context,
    config: &crate::lib::config::guild::GuildConfig,
    guild_id: &str,
    user_id: &str,
    banned_user: &serenity::User,
    data: &Data,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let ban_requests_config = match config.parse_ban_requests_config() {
        Some(cfg) => cfg,
        None => return Ok(()),
    };
    if !config.can_log_event(LoggingEvent::BanRequestReviewed) {
        return Ok(());
    }

    let (bot_id, bot_name) = {
        let bot_user = ctx.cache.current_user();
        (bot_user.id.to_string(), bot_user.name.clone())
    };

    use crate::lib::entities::ban_request::{Column as BRCol, Entity as BREntity, RequestStatus};

    let results = BREntity::find()
        .filter(BRCol::TargetId.eq(user_id))
        .filter(BRCol::GuildId.eq(guild_id))
        .filter(BRCol::Status.eq(RequestStatus::Pending))
        .all(&data.db)
        .await?;

    if results.is_empty() {
        return Ok(());
    }

    BREntity::update_many()
        .col_expr(
            BRCol::Status,
            Expr::value(RequestStatus::AutoResolved).cast_as(Alias::new("\"RequestStatus\"")),
        )
        .col_expr(BRCol::ResolvedBy, Expr::value(bot_id.clone()))
        .col_expr(
            BRCol::ResolvedAt,
            Expr::value(chrono::Utc::now().naive_utc()),
        )
        .filter(BRCol::TargetId.eq(user_id))
        .filter(BRCol::GuildId.eq(guild_id))
        .filter(BRCol::Status.eq(RequestStatus::Pending))
        .exec(&data.db)
        .await?;

    for request in &results {
        let requested_by = request.requested_by.clone();
        let reason = request.reason.clone();
        let expires_at = request.expires_at.map(|dt| dt.and_utc());
        let requested_at = Some(request.requested_at.and_utc());

        let mut fields = vec![
            ("Target", crate::utils::user_mention_with_id(user_id), false),
            (
                "Requested By",
                crate::utils::user_mention_with_id(&requested_by),
                false,
            ),
            ("Reason", reason, false),
            (
                "Reviewer Reason",
                "Resolved automatically from user ban.".to_string(),
                false,
            ),
        ];
        if let (Some(expires), Some(requested)) = (expires_at, requested_at) {
            let duration_ms = (expires - requested).num_milliseconds().max(0) as u64;
            fields.insert(
                2,
                (
                    "Duration",
                    crate::utils::format_duration_ms(duration_ms),
                    false,
                ),
            );
        }

        // TS ban request embed footer has no iconURL — only text.
        let embed = serenity::CreateEmbed::new()
            .color(0x57F287) // Green
            .author(serenity::CreateEmbedAuthor::new("Ban Request AutoResolved"))
            .thumbnail(banned_user.face())
            .fields(fields)
            .footer(serenity::CreateEmbedFooter::new(format!(
                "Reviewed by @{} ({})",
                bot_name, bot_id
            )))
            .timestamp(serenity::Timestamp::now());

        config
            .log(
                ctx.http.as_ref(),
                LoggingEvent::BanRequestReviewed,
                serenity::ExecuteWebhook::new().embed(embed),
            )
            .await;
    }

    // Bulk-delete the request messages from the webhook channel.
    if let Some(ref channel_id_str) = ban_requests_config.webhook_channel {
        if let Ok(channel_id) = channel_id_str.parse::<u64>() {
            let channel = serenity::ChannelId::new(channel_id);
            let msg_ids: Vec<serenity::MessageId> = results
                .iter()
                .filter_map(|r| r.id.parse::<u64>().ok().map(serenity::MessageId::new))
                .collect();

            if !msg_ids.is_empty() {
                delete_submission_messages(ctx, channel, &msg_ids).await;
            }
        }
    }

    info!(
        "Auto-resolved {} pending ban requests for {} in guild {}",
        results.len(),
        user_id,
        guild_id
    );
    Ok(())
}

async fn delete_submission_messages(
    ctx: &serenity::Context,
    channel: serenity::ChannelId,
    ids: &[serenity::MessageId],
) {
    let now = chrono::Utc::now().timestamp_millis();

    // Discord bulk delete only accepts messages younger than 14 days, matching
    // discord.js bulkDelete(ids, filterOld: true) which silently skips old messages.
    let bulk_eligible: Vec<serenity::MessageId> = ids
        .iter()
        .copied()
        .filter(|id| (now - snowflake_to_timestamp_ms(*id)) < BULK_DELETE_MAX_AGE_MS)
        .collect();

    // Discord bulk delete requires 2-100 messages. Fall back per chunk so
    // counts like 101 still delete the final single message.
    for chunk in bulk_eligible.chunks(BULK_DELETE_LIMIT) {
        match chunk {
            [] => {}
            [single] => {
                let _ = channel.delete_message(ctx, *single).await;
            }
            _ => {
                let _ = channel.delete_messages(ctx, chunk).await;
            }
        }
    }
}

fn snowflake_to_timestamp_ms(id: serenity::MessageId) -> i64 {
    (id.get() as i64 >> 22) + DISCORD_EPOCH
}
