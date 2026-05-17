use crate::Data;
use crate::lib::config::guild::GuildConfig;
use poise::serenity_prelude as serenity;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;
use tracing::warn;

static REPORT_TARGET_KV: LazyLock<RwLock<HashMap<String, serenity::Message>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static KV_CLEANUP_STARTED: AtomicBool = AtomicBool::new(false);
const KV_CLEANUP_INTERVAL_MS: u64 = 60 * 60 * 1000;

/// Starts the report-message KV cleanup job (hourly).
pub fn start_kv_cleanup_job() {
    if KV_CLEANUP_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(KV_CLEANUP_INTERVAL_MS)).await;
            let mut kv = REPORT_TARGET_KV.write().await;
            kv.clear();
        }
    });
}

/// Cache a target message for report modal flow.
pub async fn cache_target_message(message: &serenity::Message) {
    let mut kv = REPORT_TARGET_KV.write().await;
    kv.insert(message.id.to_string(), message.clone());
}

/// Fetch a cached target message, if present.
pub async fn get_cached_target_message(message_id: &str) -> Option<serenity::Message> {
    let kv = REPORT_TARGET_KV.read().await;
    kv.get(message_id).cloned()
}

/// Remove a cached target message after modal submission.
pub async fn remove_cached_target_message(message_id: &str) {
    let mut kv = REPORT_TARGET_KV.write().await;
    kv.remove(message_id);
}

/// Upserts a message report.
///
/// - Rejects blacklisted reporters, immune targets, and bot/system/webhook messages.
/// - If a pending report exists, appends the reporter to the existing report embed+DB.
/// - Otherwise creates a new report webhook message and persists it.
pub async fn upsert_report(
    ctx: &serenity::Context,
    data: &Data,
    config: &GuildConfig,
    reporter: &serenity::User,
    message: &serenity::Message,
    guild_id_hint: Option<serenity::GuildId>,
    reason: Option<&str>,
) -> Result<(), String> {
    let guild_id = if let Some(id) = message.guild_id.or(guild_id_hint) {
        id
    } else if config.id.get() != 0 {
        config.id
    } else {
        let from_channel = message
            .channel_id
            .to_channel(ctx)
            .await
            .ok()
            .and_then(|c| c.guild())
            .map(|gc| gc.guild_id);
        from_channel.ok_or("Failed to resolve guild context for this report.")?
    };
    let guild_id_str = guild_id.to_string();
    let reporter_id = reporter.id.to_string();
    let message_id = message.id.to_string();

    if config
        .data
        .message_reports
        .blacklisted_users
        .contains(&reporter_id)
    {
        return Err("You cannot report this message.".to_string());
    }

    // TS uses `message.guild.members.cache.get(...) ?? null`; do not REST-fetch here.
    // If the target member is not cached, immunity is not applied.
    let target_member = guild_id
        .to_guild_cached(ctx)
        .and_then(|guild| guild.members.get(&message.author.id).cloned());
    let is_immune = target_member
        .as_ref()
        .map(|m| {
            config
                .data
                .message_reports
                .immune_roles
                .iter()
                .any(|role| m.roles.iter().any(|r| r.to_string() == *role))
        })
        .unwrap_or(false);
    if is_immune {
        return Err("You cannot report this message.".to_string());
    }

    if message.author.bot || message.webhook_id.is_some() || is_system_message_kind(message.kind) {
        return Err("You cannot report bot, system, or webhook messages.".to_string());
    }

    let webhook_url = config
        .data
        .message_reports
        .webhook_url
        .as_ref()
        .cloned()
        .ok_or_else(|| "Message reports webhook is not configured.".to_string())?;

    let webhook = serenity::Webhook::from_url(ctx, &webhook_url)
        .await
        .map_err(|_| "Failed to submit message report.".to_string())?;

    use crate::lib::entities::message_report::{Column as MRCol, Entity as MREntity, ReportStatus};

    if let Ok(Some(existing)) = MREntity::find()
        .filter(MRCol::GuildId.eq(guild_id_str.clone()))
        .filter(MRCol::MessageId.eq(message_id.clone()))
        .filter(MRCol::Status.eq(ReportStatus::Pending))
        .one(&data.db)
        .await
    {
        let original_reporter = existing.reported_by.clone();
        let report_id = existing.id.clone();
        let additional = existing.additional_reporters.clone();

        if original_reporter == reporter_id {
            return Err("You have already reported this message.".to_string());
        }

        if additional.iter().any(|id| id == &reporter_id) {
            return Ok(());
        }

        let report_message_id = match report_id.parse::<u64>() {
            Ok(id) => serenity::MessageId::new(id),
            Err(_) => return Ok(()),
        };

        let existing_webhook_message = webhook.get_message(ctx, None, report_message_id).await;
        let Ok(webhook_message) = existing_webhook_message else {
            return Ok(());
        };

        let embed_idx = if webhook_message.embeds.len() > 1 {
            1
        } else {
            0
        };
        let Some(current_embed) = webhook_message.embeds.get(embed_idx) else {
            return Ok(());
        };

        let current_reported_by = current_embed
            .fields
            .iter()
            .find(|field| field.name == "Reported By")
            .map(|field| field.value.clone());
        let Some(current_reported_by) = current_reported_by else {
            return Ok(());
        };

        if current_reported_by.contains(&reporter_id) {
            return Ok(());
        }

        // Build a modified field list, replacing only "Reported By".
        // We cannot use CreateEmbed::from(current_embed).fields(list) because
        // from() preserves existing fields and .fields() appends, doubling everything.
        // TS uses spliceFields(0, 1, {...}) which replaces in-place.
        let mut fields: Vec<(String, String, bool)> = current_embed
            .fields
            .iter()
            .map(|f| (f.name.clone(), f.value.clone(), f.inline))
            .collect();
        if let Some(idx) = fields.iter().position(|f| f.0 == "Reported By") {
            fields[idx] = (
                "Reported By".to_string(),
                format!(
                    "{}\n{}",
                    current_reported_by,
                    crate::utils::user_mention_with_id(&reporter_id)
                ),
                false,
            );
        }

        // Rebuild from scratch to avoid field duplication.
        let mut updated_embed = serenity::CreateEmbed::new();
        if let Some(author) = &current_embed.author {
            let mut ea = serenity::CreateEmbedAuthor::new(&author.name);
            if let Some(icon) = &author.icon_url {
                ea = ea.icon_url(icon);
            }
            updated_embed = updated_embed.author(ea);
        }
        if let Some(color) = current_embed.colour {
            updated_embed = updated_embed.color(color.0);
        }
        if let Some(desc) = &current_embed.description {
            updated_embed = updated_embed.description(desc);
        }
        if let Some(thumbnail) = &current_embed.thumbnail {
            updated_embed = updated_embed.thumbnail(&thumbnail.url);
        }
        updated_embed = updated_embed
            .fields(fields)
            .timestamp(serenity::Timestamp::now());

        let embeds = if embed_idx == 1 {
            vec![webhook_message.embeds[0].clone().into(), updated_embed]
        } else {
            vec![updated_embed]
        };

        let _ = webhook
            .edit_message(
                ctx,
                report_message_id,
                serenity::EditWebhookMessage::new().embeds(embeds),
            )
            .await;

        let mut new_additional = additional.clone();
        new_additional.push(reporter_id.clone());
        let mut active: crate::lib::entities::message_report::ActiveModel = existing.into();
        active.additional_reporters = Set(new_additional);
        if let Err(err) = active.update(&data.db).await {
            warn!(
                report_id,
                reporter_id, "Failed to append additional message reporter: {err}"
            );
        }
        return Ok(());
    }

    let cleaned_content = crate::utils::messages::clean_content(
        &message.content,
        &ctx.cache,
        message.guild_id,
        &message.mentions,
    );
    let cropped_content = crate::utils::crop_lines(&cleaned_content, 5);
    let message_sticker_id = message.sticker_items.first().map(|s| s.id.to_string());
    let formatted_content = format_message_block(
        ctx,
        Some(&message.link()),
        Some(&cropped_content),
        Some(message.timestamp.unix_timestamp()),
        message_sticker_id.as_deref(),
    )
    .await;

    let reason_text = reason.unwrap_or("No reason provided.");

    let embed = serenity::CreateEmbed::new()
        .author(serenity::CreateEmbedAuthor::new("New Message Report"))
        .color(0x3498DB) // Colors.Blue
        .thumbnail(message.author.face())
        .fields(vec![
            (
                "Reported By",
                crate::utils::user_mention_with_id(&reporter.id.to_string()),
                false,
            ),
            ("Report Reason", reason_text.to_string(), false),
            (
                "Message Author",
                crate::utils::user_mention_with_id(&message.author.id.to_string()),
                false,
            ),
            ("Message Content", formatted_content, false),
        ])
        .timestamp(serenity::Timestamp::now());

    let mut embeds = Vec::new();
    let resolve_button = serenity::CreateButton::new("message-report-resolve")
        .label("Resolve")
        .style(serenity::ButtonStyle::Success);
    let disregard_button = serenity::CreateButton::new("message-report-disregard")
        .label("Disregard")
        .style(serenity::ButtonStyle::Primary);
    let user_info_button = serenity::CreateButton::new(format!("user-info-{}", message.author.id))
        .label("User Info")
        .style(serenity::ButtonStyle::Secondary);
    let delete_message_button = serenity::CreateButton::new(format!(
        "delete-original-report-message-{}-{}",
        message.channel_id, message.id
    ))
    .label("Delete Message")
    .style(serenity::ButtonStyle::Danger);
    let reference_message = resolve_reference_message(ctx, message).await;

    if let Some(reference) = reference_message.as_ref() {
        let reference_cleaned = crate::utils::messages::clean_content(
            &reference.content,
            &ctx.cache,
            reference.guild_id,
            &reference.mentions,
        );
        let reference_cropped = crate::utils::crop_lines(&reference_cleaned, 5);
        let reference_sticker_id = reference.sticker_items.first().map(|s| s.id.to_string());
        let reference_formatted = format_message_block(
            ctx,
            Some(&reference.link()),
            Some(&reference_cropped),
            Some(reference.timestamp.unix_timestamp()),
            reference_sticker_id.as_deref(),
        )
        .await;

        embeds.push(
            serenity::CreateEmbed::new()
                .author(serenity::CreateEmbedAuthor::new("Message Reference"))
                .color(0x23272a) // Colors.NotQuiteBlack
                .fields(vec![
                    (
                        "Reference Author",
                        crate::utils::user_mention_with_id(&reference.author.id.to_string()),
                        false,
                    ),
                    ("Reference Content", reference_formatted, false),
                ])
                .timestamp(serenity::Timestamp::now()),
        );

        let delete_reference_button = serenity::CreateButton::new(format!(
            "delete-reference-report-message-{}-{}",
            reference.channel_id, reference.id
        ))
        .label("Delete Reference")
        .style(serenity::ButtonStyle::Danger);
        let row = serenity::CreateActionRow::Buttons(vec![
            resolve_button,
            disregard_button,
            delete_message_button,
            delete_reference_button,
            user_info_button,
        ]);
        embeds.push(embed);

        let content = if config.data.message_reports.notify_roles.is_empty() {
            None
        } else {
            Some(
                config
                    .data
                    .message_reports
                    .notify_roles
                    .iter()
                    .map(|role| {
                        if role == "here" {
                            "@here".to_string()
                        } else {
                            format!("<@&{}>", role)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        };

        let allowed_mentions = serenity::CreateAllowedMentions::new()
            .all_roles(true)
            .everyone(true)
            .all_users(false);
        let mut webhook_msg = serenity::ExecuteWebhook::new()
            .components(vec![row])
            .allowed_mentions(allowed_mentions);
        if let Some(content) = content {
            webhook_msg = webhook_msg.content(content);
        }
        for embed in embeds {
            webhook_msg = webhook_msg.embed(embed);
        }

        let log = webhook
            .execute(ctx, true, webhook_msg)
            .await
            .ok()
            .flatten()
            .ok_or_else(|| "Failed to submit message report.".to_string())?;

        let reference_id = reference_message.as_ref().map(|m| m.id.to_string());

        let model = crate::lib::entities::message_report::ActiveModel {
            id: Set(log.id.to_string()),
            guild_id: Set(guild_id_str),
            message_id: Set(message_id),
            reference_id: Set(reference_id),
            message_url: Set(message.link()),
            channel_id: Set(message.channel_id.to_string()),
            author_id: Set(message.author.id.to_string()),
            content: Set(Some(cleaned_content.clone())),
            reported_at: Set(chrono::Utc::now().naive_utc()),
            reported_by: Set(reporter.id.to_string()),
            report_reason: Set(reason_text.to_string()),
            status: Set(ReportStatus::Pending),
            additional_reporters: Set(vec![]),
            resolved_at: Set(None),
            resolved_by: Set(None),
        };
        crate::lib::entities::message_report::Entity::insert(model)
            .exec(&data.db)
            .await
            .map_err(|_| "Failed to submit message report.".to_string())?;

        return Ok(());
    }

    embeds.push(embed);

    let content = if config.data.message_reports.notify_roles.is_empty() {
        None
    } else {
        Some(
            config
                .data
                .message_reports
                .notify_roles
                .iter()
                .map(|role| {
                    if role == "here" {
                        "@here".to_string()
                    } else {
                        format!("<@&{}>", role)
                    }
                })
                .collect::<Vec<_>>()
                .join(", "),
        )
    };

    let row = serenity::CreateActionRow::Buttons(vec![
        resolve_button,
        disregard_button,
        user_info_button,
        delete_message_button,
    ]);
    let allowed_mentions = serenity::CreateAllowedMentions::new()
        .all_roles(true)
        .everyone(true)
        .all_users(false);
    let mut webhook_msg = serenity::ExecuteWebhook::new()
        .components(vec![row])
        .allowed_mentions(allowed_mentions);
    if let Some(content) = content {
        webhook_msg = webhook_msg.content(content);
    }
    for embed in embeds {
        webhook_msg = webhook_msg.embed(embed);
    }

    let log = webhook
        .execute(ctx, true, webhook_msg)
        .await
        .ok()
        .flatten()
        .ok_or_else(|| "Failed to submit message report.".to_string())?;

    let reference_id = reference_message.as_ref().map(|m| m.id.to_string());

    let model = crate::lib::entities::message_report::ActiveModel {
        id: Set(log.id.to_string()),
        guild_id: Set(guild_id_str),
        message_id: Set(message_id),
        reference_id: Set(reference_id),
        message_url: Set(message.link()),
        channel_id: Set(message.channel_id.to_string()),
        author_id: Set(message.author.id.to_string()),
        content: Set(Some(cleaned_content)),
        reported_at: Set(chrono::Utc::now().naive_utc()),
        reported_by: Set(reporter.id.to_string()),
        report_reason: Set(reason_text.to_string()),
        status: Set(ReportStatus::Pending),
        additional_reporters: Set(vec![]),
        resolved_at: Set(None),
        resolved_by: Set(None),
    };
    crate::lib::entities::message_report::Entity::insert(model)
        .exec(&data.db)
        .await
        .map_err(|_| "Failed to submit message report.".to_string())?;

    Ok(())
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

async fn resolve_reference_message(
    ctx: &serenity::Context,
    message: &serenity::Message,
) -> Option<serenity::Message> {
    let reference = message.message_reference.as_ref()?;
    let message_id = reference.message_id?;
    reference.channel_id.message(ctx, message_id).await.ok()
}

async fn format_message_block(
    ctx: &serenity::Context,
    url: Option<&str>,
    content: Option<&str>,
    relative_timestamp: Option<i64>,
    sticker_id: Option<&str>,
) -> String {
    let mut prefix_parts = Vec::new();
    if let Some(ts) = relative_timestamp {
        prefix_parts.push(format!("Sent on <t:{ts}:f>"));
    }
    if let Some(url) = url {
        prefix_parts.push(format!("[Jump to message]({url})"));
    }
    if let Some(sticker_id) = sticker_id {
        if let Ok(id) = sticker_id.parse::<u64>() {
            if let Ok(sticker) = serenity::StickerId::new(id)
                .to_sticker(ctx.http.clone())
                .await
            {
                if sticker.format_type == serenity::StickerFormatType::Lottie {
                    prefix_parts.push(format!("Lottie Sticker: {}", sticker.name));
                } else if let Some(sticker_url) = sticker.image_url() {
                    prefix_parts.push(format!("[Sticker: {}]({})", sticker.name, sticker_url));
                }
            }
        }
    }

    let prefix = prefix_parts.join(" `|` ");
    // The hastebin case needs the separator; the code block case does NOT (direct concatenation).
    let separator = if prefix.is_empty() { "" } else { " `|` " };

    let content = match content {
        Some(c) if !c.is_empty() => c,
        _ => "Unknown content.",
    };
    let escaped = crate::utils::messages::escape_code_block(content);
    if escaped.len() > 900 {
        if let Some(url) = crate::utils::hastebin(&escaped, "txt").await {
            return format!("{prefix}{separator}[View full content]({url})");
        }
    }

    // No separator inserted between the prefix and code block (matches TS `prefix + codeBlock(...)`).
    let max_content_len = (900usize).saturating_sub(prefix.len());
    format!(
        "{}{}",
        prefix,
        crate::utils::messages::code_block(&crate::utils::truncate(&escaped, max_content_len))
    )
}
