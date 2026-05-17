use poise::serenity_prelude::{self as serenity, CreateEmbed};
use sea_orm::{EntityTrait, Set};
use sea_orm::sea_query::OnConflict;

use crate::config::schema::{LoggingEvent, LoggingWebhook, RawGuildConfig};
use crate::{Context, Data, Error};

/// Manage logging webhooks and webhook event subscriptions.
///
#[poise::command(
    slash_command,
    guild_only,
    default_member_permissions = "MANAGE_GUILD",
    subcommands("webhooks", "events"),
)]
pub async fn logging(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Webhook management group.
#[poise::command(
    slash_command,
    rename = "webhooks",
    subcommands("webhooks_create", "webhooks_delete", "webhooks_list"),
)]
pub async fn webhooks(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Event subscription management group.
#[poise::command(
    slash_command,
    rename = "events",
    subcommands("events_add", "events_remove", "events_view"),
)]
pub async fn events(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

#[poise::command(slash_command, rename = "create", ephemeral)]
pub async fn webhooks_create(
    ctx: Context<'_>,
    #[description = "The channel to create the webhook in"] channel: serenity::Channel,
    #[description = "The initial event to subscribe to"] event: LoggingEventChoice,
) -> Result<(), Error> {
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let channel_id = match validate_guild_text_channel(&channel) {
        Some(id) => id,
        None => {
            ctx.say("The selected channel must be a guild text channel.").await?;
            return Ok(());
        }
    };

    let mut config = ctx
        .data()
        .config_manager
        .get_guild_config(&ctx.data().db, guild_id)
        .await;

    if config
        .data
        .logging_webhooks
        .iter()
        .any(|wh| wh.channel_id == channel_id.to_string())
    {
        ctx.say(format!(
            "A logging webhook already exists in <#{}>. Use the `add-event` subcommand to add more events.",
            channel_id
        ))
        .await?;
        return Ok(());
    }

    let bot = ctx.serenity_context().cache.current_user().clone();
    let payload = serde_json::json!({
        "name": bot.name,
        "avatar": bot.face(),
    });

    let webhook = match ctx
        .serenity_context()
        .http
        .create_webhook(channel_id, &payload, None)
        .await
    {
        Ok(webhook) => webhook,
        Err(_) => {
            ctx.say(format!("Failed to create a webhook in <#{}>.", channel_id))
                .await?;
            return Ok(());
        }
    };

    let Ok(url) = webhook.url() else {
        ctx.say(format!("Failed to create a webhook in <#{}>.", channel_id))
            .await?;
        return Ok(());
    };

    let Some(token) = extract_webhook_token_from_url(&url) else {
        ctx.say("The created webhook did not return a token. Please try again.")
            .await?;
        return Ok(());
    };

    let webhook_data = LoggingWebhook {
        id: webhook.id.to_string(),
        url,
        token,
        channel_id: channel_id.to_string(),
        events: vec![event.into()],
    };

    config.data.logging_webhooks.push(webhook_data);
    persist_config(ctx.data(), guild_id, &config.data).await?;

    ctx.say(format!(
        "Successfully created a logging webhook in <#{}> with the event `{}`.",
        channel_id,
        format_event_name(event.into())
    ))
    .await?;
    Ok(())
}

#[poise::command(slash_command, rename = "delete", ephemeral)]
pub async fn webhooks_delete(
    ctx: Context<'_>,
    #[description = "The channel the webhook is in"] channel: serenity::Channel,
) -> Result<(), Error> {
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let channel_id = match validate_guild_text_channel(&channel) {
        Some(id) => id.to_string(),
        None => {
            ctx.say("The selected channel must be a guild text channel.").await?;
            return Ok(());
        }
    };

    let mut config = ctx
        .data()
        .config_manager
        .get_guild_config(&ctx.data().db, guild_id)
        .await;

    let Some(index) = config
        .data
        .logging_webhooks
        .iter()
        .position(|wh| wh.channel_id == channel_id)
    else {
        ctx.say(format!("No logging webhook found in <#{}>.", channel_id))
            .await?;
        return Ok(());
    };

    let webhook = config.data.logging_webhooks[index].clone();
    if let Ok(id) = webhook.id.parse::<u64>() {
        let _ = ctx
            .serenity_context()
            .http
            .delete_webhook_with_token(serenity::WebhookId::new(id), &webhook.token, None)
            .await;
    }

    config.data.logging_webhooks.remove(index);
    persist_config(ctx.data(), guild_id, &config.data).await?;

    ctx.say(format!(
        "Successfully deleted the logging webhook in <#{}>.",
        channel_id
    ))
    .await?;
    Ok(())
}

#[poise::command(slash_command, rename = "list", ephemeral)]
pub async fn webhooks_list(ctx: Context<'_>) -> Result<(), Error> {
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let config = ctx
        .data()
        .config_manager
        .get_guild_config(&ctx.data().db, guild_id)
        .await;
    let webhooks = &config.data.logging_webhooks;

    if webhooks.is_empty() {
        ctx.say("There are no logging webhooks configured for this guild.")
            .await?;
        return Ok(());
    }

    let mut lines = Vec::new();
    for webhook in webhooks {
        let events = if webhook.events.is_empty() {
            "*No events*".to_string()
        } else {
            webhook
                .events
                .iter()
                .map(|event| format!("`{}`", format_event_name(*event)))
                .collect::<Vec<_>>()
                .join(", ")
        };
        lines.push(format!("<#{}>\n└ {}", webhook.channel_id, events));
    }

    let mut author = serenity::CreateEmbedAuthor::new(format!("Logging Webhooks in {}", guild_name(ctx)));
    if let Some(icon_url) = guild_icon_url(ctx) {
        author = author.icon_url(icon_url);
    }

    let embed = CreateEmbed::new()
        .color(0x3498db)
        .author(author)
        .description(lines.join("\n\n"))
        .footer(serenity::CreateEmbedFooter::new(format!(
            "{} webhook{} configured",
            webhooks.len(),
            if webhooks.len() == 1 { "" } else { "s" }
        )))
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

#[poise::command(slash_command, rename = "add", ephemeral)]
pub async fn events_add(
    ctx: Context<'_>,
    #[description = "The channel the webhook is in"] channel: serenity::Channel,
    #[description = "The event to add"] event: LoggingEventChoice,
) -> Result<(), Error> {
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let channel_id = match validate_guild_text_channel(&channel) {
        Some(id) => id.to_string(),
        None => {
            ctx.say("The selected channel must be a guild text channel.").await?;
            return Ok(());
        }
    };

    let mut config = ctx
        .data()
        .config_manager
        .get_guild_config(&ctx.data().db, guild_id)
        .await;

    let Some(webhook) = config
        .data
        .logging_webhooks
        .iter_mut()
        .find(|wh| wh.channel_id == channel_id)
    else {
        ctx.say(format!(
            "No logging webhook found in <#{}>. Create one with the `create` subcommand first.",
            channel_id
        ))
        .await?;
        return Ok(());
    };

    let event = event.into();
    if webhook.events.contains(&event) {
        ctx.say(format!(
            "The event `{}` is already subscribed to for this webhook.",
            format_event_name(event)
        ))
        .await?;
        return Ok(());
    }

    webhook.events.push(event);
    persist_config(ctx.data(), guild_id, &config.data).await?;

    ctx.say(format!(
        "Successfully added the event `{}` to the webhook in <#{}>.",
        format_event_name(event),
        channel_id
    ))
    .await?;
    Ok(())
}

#[poise::command(slash_command, rename = "remove", ephemeral)]
pub async fn events_remove(
    ctx: Context<'_>,
    #[description = "The channel the webhook is in"] channel: serenity::Channel,
    #[description = "The event to remove"] event: LoggingEventChoice,
) -> Result<(), Error> {
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let channel_id = match validate_guild_text_channel(&channel) {
        Some(id) => id.to_string(),
        None => {
            ctx.say("The selected channel must be a guild text channel.").await?;
            return Ok(());
        }
    };

    let mut config = ctx
        .data()
        .config_manager
        .get_guild_config(&ctx.data().db, guild_id)
        .await;

    let Some(webhook) = config
        .data
        .logging_webhooks
        .iter_mut()
        .find(|wh| wh.channel_id == channel_id)
    else {
        ctx.say(format!("No logging webhook found in <#{}>.", channel_id))
            .await?;
        return Ok(());
    };

    let event = event.into();
    let initial_len = webhook.events.len();
    webhook.events.retain(|current| *current != event);

    if webhook.events.len() == initial_len {
        ctx.say(format!(
            "The event `{}` is not subscribed to for this webhook.",
            format_event_name(event)
        ))
        .await?;
        return Ok(());
    }

    let is_now_empty = webhook.events.is_empty();
    persist_config(ctx.data(), guild_id, &config.data).await?;

    let mut message = format!(
        "Successfully removed the event `{}` from the webhook in <#{}>.",
        format_event_name(event),
        channel_id
    );
    if is_now_empty {
        message.push_str(" ⚠️ This webhook now has no events and won't receive any logs.");
    }

    ctx.say(message).await?;
    Ok(())
}

#[poise::command(slash_command, rename = "view", ephemeral)]
pub async fn events_view(
    ctx: Context<'_>,
    #[description = "The channel the webhook is in"] channel: serenity::Channel,
) -> Result<(), Error> {
    let Some(guild_id) = ctx.guild_id() else {
        return Ok(());
    };

    let channel_id = match validate_guild_text_channel(&channel) {
        Some(id) => id.to_string(),
        None => {
            ctx.say("The selected channel must be a guild text channel.").await?;
            return Ok(());
        }
    };

    let config = ctx
        .data()
        .config_manager
        .get_guild_config(&ctx.data().db, guild_id)
        .await;

    let Some(webhook) = config
        .data
        .logging_webhooks
        .iter()
        .find(|wh| wh.channel_id == channel_id)
    else {
        ctx.say(format!("No logging webhook found in <#{}>.", channel_id))
            .await?;
        return Ok(());
    };

    let events = if webhook.events.is_empty() {
        "*No events configured*".to_string()
    } else {
        webhook
            .events
            .iter()
            .map(|event| format!("• `{}`", format_event_name(*event)))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let mut author = serenity::CreateEmbedAuthor::new("Logging Webhook Details");
    if let Some(icon_url) = guild_icon_url(ctx) {
        author = author.icon_url(icon_url);
    }

    let embed = CreateEmbed::new()
        .color(0x3498db)
        .author(author)
        .fields(vec![
            ("Channel", format!("<#{}>", webhook.channel_id), true),
            ("Webhook ID", format!("`{}`", webhook.id), true),
            ("Events", events, false),
        ])
        .footer(serenity::CreateEmbedFooter::new(format!("Guild ID: {}", guild_id)))
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, poise::ChoiceParameter)]
pub enum LoggingEventChoice {
    #[name = "Message Report Reviewed"]
    MessageReportReviewed,
    #[name = "Ban Request Reviewed"]
    BanRequestReviewed,
    #[name = "Ban Request Result"]
    BanRequestResult,
    #[name = "Quick Purge Result"]
    QuickPurgeResult,
    #[name = "Quick Purge Executed"]
    QuickPurgeExecuted,
    #[name = "Quick Mute Result"]
    QuickMuteResult,
    #[name = "Quick Mute Executed"]
    QuickMuteExecuted,
}

impl From<LoggingEventChoice> for LoggingEvent {
    fn from(value: LoggingEventChoice) -> Self {
        match value {
            LoggingEventChoice::MessageReportReviewed => LoggingEvent::MessageReportReviewed,
            LoggingEventChoice::BanRequestReviewed => LoggingEvent::BanRequestReviewed,
            LoggingEventChoice::BanRequestResult => LoggingEvent::BanRequestResult,
            LoggingEventChoice::QuickPurgeResult => LoggingEvent::QuickPurgeResult,
            LoggingEventChoice::QuickPurgeExecuted => LoggingEvent::QuickPurgeExecuted,
            LoggingEventChoice::QuickMuteResult => LoggingEvent::QuickMuteResult,
            LoggingEventChoice::QuickMuteExecuted => LoggingEvent::QuickMuteExecuted,
        }
    }
}

fn validate_guild_text_channel(channel: &serenity::Channel) -> Option<serenity::ChannelId> {
    match channel {
        serenity::Channel::Guild(guild_channel) if guild_channel.is_text_based() => {
            Some(guild_channel.id)
        }
        _ => None,
    }
}

fn guild_name(ctx: Context<'_>) -> String {
    ctx.guild()
        .map(|guild| guild.name.clone())
        .unwrap_or_else(|| ctx.guild_id().map(|id| id.to_string()).unwrap_or_default())
}

fn guild_icon_url(ctx: Context<'_>) -> Option<String> {
    ctx.guild().and_then(|guild| guild.icon_url())
}

async fn persist_config(
    data: &Data,
    guild_id: serenity::GuildId,
    config: &RawGuildConfig,
) -> Result<(), Error> {
    let config_json = serde_json::to_value(config)?;
    let model = crate::entities::guild::ActiveModel {
        id: Set(guild_id.to_string()),
        config: Set(config_json),
    };
    crate::entities::guild::Entity::insert(model)
        .on_conflict(
            OnConflict::column(crate::entities::guild::Column::Id)
                .update_column(crate::entities::guild::Column::Config)
                .to_owned(),
        )
        .exec(&data.db)
        .await?;
    data.config_manager.reload(&data.db, guild_id).await;
    Ok(())
}

fn format_event_name(event: LoggingEvent) -> String {
    let raw = match event {
        LoggingEvent::MessageReportReviewed => "MessageReportReviewed",
        LoggingEvent::BanRequestReviewed => "BanRequestReviewed",
        LoggingEvent::BanRequestResult => "BanRequestResult",
        LoggingEvent::QuickPurgeResult => "QuickPurgeResult",
        LoggingEvent::QuickPurgeExecuted => "QuickPurgeExecuted",
        LoggingEvent::QuickMuteResult => "QuickMuteResult",
        LoggingEvent::QuickMuteExecuted => "QuickMuteExecuted",
    };

    let mut out = String::with_capacity(raw.len() + 8);
    for (idx, ch) in raw.chars().enumerate() {
        if idx > 0 && ch.is_ascii_uppercase() {
            out.push(' ');
        }
        out.push(ch);
    }
    out
}

fn extract_webhook_token_from_url(url: &str) -> Option<String> {
    // URL format: https://discord.com/api/webhooks/{id}/{token}
    let mut parts = url.rsplitn(2, '/');
    let token = parts.next()?;
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}
