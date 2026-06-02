use poise::serenity_prelude::{self as serenity, CreateEmbed};
use sea_orm::sea_query::OnConflict;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use std::sync::{LazyLock, Mutex};

use crate::lib::config::schema::UserPermission;
use crate::{Context, Error};

/// Send an ephemeral red-embed error response, matching the TS `{ error: "..." }` pattern.
async fn reply_error(ctx: Context<'_>, message: impl Into<String>) -> Result<(), Error> {
    let embed = CreateEmbed::new()
        .description(message.into())
        .color(0xED4245u32); // Colors.Red
    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// LRU regex cache for compiled highlight patterns.
static REGEX_CACHE: LazyLock<Mutex<lru::LruCache<String, fancy_regex::Regex>>> =
    LazyLock::new(|| {
        Mutex::new(lru::LruCache::new(
            std::num::NonZeroUsize::new(100).unwrap(),
        ))
    });

/// Rate limiter for highlight DMs (1 per 15 seconds per user:author pair).
static HIGHLIGHT_RATE_LIMITER: LazyLock<crate::utils::RateLimiter> =
    LazyLock::new(|| crate::utils::RateLimiter::new(1, 15_000));

/// Manage highlight patterns and settings.
///
#[poise::command(
    slash_command,
    guild_only,
    default_member_permissions = "MANAGE_MESSAGES",
    subcommands("pattern", "channel_scoping", "user_blacklist", "list", "clear")
)]
pub async fn highlights(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Manage highlight patterns.
#[poise::command(
    slash_command,
    rename = "pattern",
    subcommands("pattern_add", "pattern_remove", "pattern_clear")
)]
pub async fn pattern(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Manage your highlight channel scoping.
#[poise::command(
    slash_command,
    rename = "channel-scoping",
    subcommands("channel_add", "channel_remove", "channel_clear")
)]
pub async fn channel_scoping(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Manage your highlight user blacklist.
#[poise::command(
    slash_command,
    rename = "user-blacklist",
    subcommands("blacklist_add", "blacklist_remove", "blacklist_clear")
)]
pub async fn user_blacklist(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Add a highlight pattern.
#[poise::command(slash_command, rename = "add", ephemeral)]
pub async fn pattern_add(
    ctx: Context<'_>,
    #[description = "The pattern to add"]
    #[max_length = 45]
    pattern: String,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    // Get or create highlight entry.
    let existing = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?;

    let patterns: Vec<String> = if let Some(ref row) = existing {
        row.patterns.clone()
    } else {
        // Create entry if it does not exist yet.
        let new_row = crate::lib::entities::highlight::ActiveModel {
            user_id: Set(user_id.clone()),
            guild_id: Set(guild_id.clone()),
            patterns: Set(vec![]),
            user_blacklist: Set(Some(vec![])),
        };
        let _ = crate::lib::entities::highlight::Entity::insert(new_row)
            .on_conflict(
                OnConflict::columns([
                    crate::lib::entities::highlight::Column::UserId,
                    crate::lib::entities::highlight::Column::GuildId,
                ])
                .do_nothing()
                .to_owned(),
            )
            .exec(&data.db)
            .await;
        vec![]
    };

    // Get max patterns from config.
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id_obj)
        .await;
    let max_patterns = config.data.highlights.max_patterns as usize;

    if patterns.len() >= max_patterns {
        return reply_error(
            ctx,
            format!("You have reached the maximum number of highlight patterns ({max_patterns})."),
        )
        .await;
    }

    if !is_safe_highlight_pattern(&pattern) {
        return reply_error(ctx, "The provided pattern has been flagged as unsafe or it exceeds the repetition limit (`25`).").await;
    }

    if patterns.contains(&pattern) {
        return reply_error(
            ctx,
            format!("The pattern `{pattern}` already exists in your highlight patterns."),
        )
        .await;
    }

    // Add pattern by fetching fresh row, pushing, then updating.
    if let Some(mut active) = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?
        .map(crate::lib::entities::highlight::ActiveModel::from)
    {
        let mut new_patterns = active.patterns.unwrap();
        new_patterns.push(pattern.clone());
        active.patterns = Set(new_patterns);
        active.update(&data.db).await?;
    }

    ctx.say(format!(
        "Successfully added `{pattern}` to your highlights."
    ))
    .await?;
    Ok(())
}

/// Remove a highlight pattern.
#[poise::command(slash_command, rename = "remove", ephemeral)]
pub async fn pattern_remove(
    ctx: Context<'_>,
    #[description = "The pattern to remove"] pattern: String,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    let row = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?;

    let patterns = if let Some(ref r) = row {
        r.patterns.clone()
    } else {
        Vec::new()
    };

    if !patterns.contains(&pattern) {
        return reply_error(
            ctx,
            format!("The pattern `{pattern}` does not exist in your highlight patterns."),
        )
        .await;
    }

    if let Some(mut active) = row.map(crate::lib::entities::highlight::ActiveModel::from) {
        let updated: Vec<String> = patterns.into_iter().filter(|p| p != &pattern).collect();
        active.patterns = Set(updated);
        active.update(&data.db).await?;
    }

    ctx.say(format!(
        "Successfully removed `{pattern}` from your highlights."
    ))
    .await?;
    Ok(())
}

/// Clear all highlight patterns.
#[poise::command(slash_command, rename = "clear", ephemeral)]
pub async fn pattern_clear(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    let row = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?;

    let patterns = if let Some(ref r) = row {
        r.patterns.clone()
    } else {
        Vec::new()
    };

    if patterns.is_empty() {
        ctx.say("You have no highlight patterns to clear.").await?;
        return Ok(());
    }

    if let Some(mut active) = row.map(crate::lib::entities::highlight::ActiveModel::from) {
        active.patterns = Set(vec![]);
        active.update(&data.db).await?;
    }

    ctx.say(format!(
        "Successfully cleared `{}` {}.",
        patterns.len(),
        crate::utils::inflect(patterns.len() as u64, "highlight pattern")
    ))
    .await?;
    Ok(())
}

/// Add a channel to your highlight scoping.
#[poise::command(slash_command, rename = "add", ephemeral)]
pub async fn channel_add(
    ctx: Context<'_>,
    #[description = "The channel to add"] channel: serenity::Channel,
    #[description = "Include or exclude highlights from this channel"]
    #[rename = "type"]
    scope_type: ScopeType,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();
    let channel_id = channel.id().to_string();
    let type_val: i32 = scope_type as i32;

    // Ensure highlight entry exists first.
    let new_row = crate::lib::entities::highlight::ActiveModel {
        user_id: Set(user_id.clone()),
        guild_id: Set(guild_id.clone()),
        patterns: Set(vec![]),
        user_blacklist: Set(Some(vec![])),
    };
    let _ = crate::lib::entities::highlight::Entity::insert(new_row)
        .on_conflict(
            OnConflict::columns([
                crate::lib::entities::highlight::Column::UserId,
                crate::lib::entities::highlight::Column::GuildId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec(&data.db)
        .await;

    // Check if scoping already exists for this channel.
    let existing = crate::lib::entities::highlight_channel_scoping::Entity::find()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id.clone()))
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id.clone()),
        )
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::ChannelId
                .eq(channel_id.clone()),
        )
        .one(&data.db)
        .await?;

    if existing.is_some() {
        return reply_error(
            ctx,
            format!("<#{channel_id}> is already in your highlight scoping."),
        )
        .await;
    }

    crate::lib::entities::highlight_channel_scoping::Entity::insert(
        crate::lib::entities::highlight_channel_scoping::ActiveModel {
            user_id: Set(user_id),
            guild_id: Set(guild_id),
            channel_id: Set(channel_id.clone()),
            scope_type: Set(type_val),
        },
    )
    .exec(&data.db)
    .await?;

    let action = if scope_type == ScopeType::Include {
        "include"
    } else {
        "exclude"
    };
    ctx.say(format!(
        "Successfully {}d <#{channel_id}> for your highlights.",
        action
    ))
    .await?;
    Ok(())
}

/// Remove a channel from your highlight scoping.
#[poise::command(slash_command, rename = "remove", ephemeral)]
pub async fn channel_remove(
    ctx: Context<'_>,
    #[description = "The channel to remove"] channel: serenity::Channel,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();
    let channel_id = channel.id().to_string();

    let existing = crate::lib::entities::highlight_channel_scoping::Entity::find()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id.clone()))
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id.clone()),
        )
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::ChannelId
                .eq(channel_id.clone()),
        )
        .one(&data.db)
        .await?;

    if existing.is_none() {
        return reply_error(
            ctx,
            format!("<#{channel_id}> is not in your highlight scoping."),
        )
        .await;
    }

    crate::lib::entities::highlight_channel_scoping::Entity::delete_many()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id))
        .filter(crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id))
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::ChannelId
                .eq(channel_id.clone()),
        )
        .exec(&data.db)
        .await?;

    ctx.say(format!(
        "Successfully removed <#{channel_id}> from your highlight scoping."
    ))
    .await?;
    Ok(())
}

/// Clear all channel scoping for your highlights.
#[poise::command(slash_command, rename = "clear", ephemeral)]
pub async fn channel_clear(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    use sea_orm::PaginatorTrait;
    let count = crate::lib::entities::highlight_channel_scoping::Entity::find()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id.clone()))
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id.clone()),
        )
        .count(&data.db)
        .await?;

    if count == 0 {
        ctx.say("You have no highlight channel scoping to clear.")
            .await?;
        return Ok(());
    }

    crate::lib::entities::highlight_channel_scoping::Entity::delete_many()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id))
        .filter(crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id))
        .exec(&data.db)
        .await?;

    ctx.say(format!(
        "Successfully cleared `{}` {}.",
        count,
        crate::utils::inflect(count, "highlight channel scoping")
    ))
    .await?;
    Ok(())
}

/// Blacklist a user from triggering your highlights.
#[poise::command(slash_command, rename = "add", ephemeral)]
pub async fn blacklist_add(
    ctx: Context<'_>,
    #[description = "The user to add"] user: serenity::User,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();
    let target_id = user.id.to_string();

    if target_id == user_id {
        return reply_error(ctx, "You cannot blacklist yourself.").await;
    }

    let row = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?;

    let (existing_patterns, mut user_blacklist) = if let Some(ref r) = row {
        (
            r.patterns.clone(),
            r.user_blacklist.clone().unwrap_or_default(),
        )
    } else {
        (vec![], vec![])
    };

    if user_blacklist.contains(&target_id) {
        return reply_error(
            ctx,
            format!("<@{target_id}> is already blacklisted from triggering your highlights."),
        )
        .await;
    }
    user_blacklist.push(target_id.clone());

    let new_row = crate::lib::entities::highlight::ActiveModel {
        user_id: Set(user_id),
        guild_id: Set(guild_id),
        patterns: Set(existing_patterns),
        user_blacklist: Set(Some(user_blacklist)),
    };
    crate::lib::entities::highlight::Entity::insert(new_row)
        .on_conflict(
            OnConflict::columns([
                crate::lib::entities::highlight::Column::UserId,
                crate::lib::entities::highlight::Column::GuildId,
            ])
            .update_column(crate::lib::entities::highlight::Column::UserBlacklist)
            .to_owned(),
        )
        .exec(&data.db)
        .await?;

    ctx.say(format!(
        "Successfully blacklisted <@{target_id}> from triggering your highlights."
    ))
    .await?;
    Ok(())
}

/// Remove a user from your highlight blacklist.
#[poise::command(slash_command, rename = "remove", ephemeral)]
pub async fn blacklist_remove(
    ctx: Context<'_>,
    #[description = "The user to remove"] user: serenity::User,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();
    let target_id = user.id.to_string();

    let row = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?;

    let user_blacklist = if let Some(ref r) = row {
        r.user_blacklist.clone().unwrap_or_default()
    } else {
        Vec::new()
    };

    if !user_blacklist.contains(&target_id) {
        return reply_error(
            ctx,
            format!("<@{target_id}> is not in your highlight blacklist."),
        )
        .await;
    }

    if let Some(mut active) = row.map(crate::lib::entities::highlight::ActiveModel::from) {
        let updated: Vec<String> = user_blacklist
            .into_iter()
            .filter(|u| u != &target_id)
            .collect();
        active.user_blacklist = Set(Some(updated));
        active.update(&data.db).await?;
    }

    ctx.say(format!(
        "Successfully removed <@{target_id}> from your highlight blacklist."
    ))
    .await?;
    Ok(())
}

/// Clear all users from your highlight blacklist.
#[poise::command(slash_command, rename = "clear", ephemeral)]
pub async fn blacklist_clear(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    let row = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?;

    let user_blacklist = if let Some(ref r) = row {
        r.user_blacklist.clone().unwrap_or_default()
    } else {
        Vec::new()
    };

    if user_blacklist.is_empty() {
        ctx.say("You have no highlight user blacklist to clear.")
            .await?;
        return Ok(());
    }

    if let Some(mut active) = row.map(crate::lib::entities::highlight::ActiveModel::from) {
        active.user_blacklist = Set(Some(vec![]));
        active.update(&data.db).await?;
    }

    ctx.say(format!(
        "Successfully cleared `{}` {}.",
        user_blacklist.len(),
        crate::utils::inflect(
            user_blacklist.len() as u64,
            "highlight user blacklist entry"
        )
    ))
    .await?;
    Ok(())
}

/// List your current highlight patterns and scoping.
#[poise::command(slash_command, ephemeral)]
pub async fn list(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    // Fetch highlight entry.
    let row = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id.clone()))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id.clone()))
        .one(&data.db)
        .await?;

    if row.is_none() {
        ctx.say("You have no highlights set up.").await?;
        return Ok(());
    }

    let (patterns, blacklist) = match row {
        Some(ref r) => (
            r.patterns.clone(),
            r.user_blacklist.clone().unwrap_or_default(),
        ),
        None => (vec![], vec![]),
    };

    // Fetch channel scoping.
    let scoping_rows: Vec<crate::lib::entities::highlight_channel_scoping::Model> =
        crate::lib::entities::highlight_channel_scoping::Entity::find()
            .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id))
            .filter(crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id))
            .all(&data.db)
            .await?;

    let mut included = Vec::new();
    let mut excluded = Vec::new();
    for row in &scoping_rows {
        if row.scope_type == 0 {
            included.push(row.channel_id.clone());
        } else {
            excluded.push(row.channel_id.clone());
        }
    }

    let pattern_count = patterns.len();
    let raw_patterns = if patterns.is_empty() {
        "None".to_string()
    } else {
        patterns
            .iter()
            .map(|p| format!("`{p}`"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let mut patterns_value = raw_patterns.clone();
    if raw_patterns.len() > 1024 {
        if let Some(url) = crate::utils::hastebin(&raw_patterns, "ts").await {
            patterns_value = crate::utils::truncate(&format!("[View Full List]({url})"), 1024);
        }
    }

    let blacklisted_users = if blacklist.is_empty() {
        "None".to_string()
    } else {
        blacklist
            .iter()
            .map(|u| format!("<@{u}>"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let included_channels_value = if included.is_empty() {
        "None".to_string()
    } else {
        included
            .iter()
            .map(|c| format!("<#{c}>"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let excluded_channels_value = if excluded.is_empty() {
        "None".to_string()
    } else {
        excluded
            .iter()
            .map(|c| format!("<#{c}>"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let embed = CreateEmbed::new()
        .color(0x3498DB) // Colors.Blue
        .author(
            serenity::CreateEmbedAuthor::new(format!("Highlights for @{}", ctx.author().name))
                .icon_url(ctx.author().face()),
        )
        .fields(vec![
            (format!("Patterns ({pattern_count})"), patterns_value, false),
            (
                format!("Included Channels ({})", included.len()),
                included_channels_value,
                true,
            ),
            (
                format!("Excluded Channels ({})", excluded.len()),
                excluded_channels_value,
                true,
            ),
            (
                format!("Blacklisted Users ({})", blacklist.len()),
                blacklisted_users,
                true,
            ),
        ])
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// Clear all highlight patterns and scoping.
#[poise::command(slash_command, ephemeral)]
pub async fn clear(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    use sea_orm::PaginatorTrait;
    let scoping_count = crate::lib::entities::highlight_channel_scoping::Entity::find()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id.clone()))
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id.clone()),
        )
        .count(&data.db)
        .await?;

    crate::lib::entities::highlight_channel_scoping::Entity::delete_many()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::UserId.eq(user_id.clone()))
        .filter(
            crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(guild_id.clone()),
        )
        .exec(&data.db)
        .await?;

    // Delete highlight entry.
    crate::lib::entities::highlight::Entity::delete_many()
        .filter(crate::lib::entities::highlight::Column::UserId.eq(user_id))
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(guild_id))
        .exec(&data.db)
        .await?;

    if scoping_count == 0 {
        ctx.say("You have no highlights to clear.").await?;
        return Ok(());
    }

    ctx.say(format!(
        "Successfully erased `{}` {}.",
        scoping_count,
        crate::utils::inflect(scoping_count, "highlight")
    ))
    .await?;
    Ok(())
}

/// Channel scoping type choice.
#[derive(Debug, Clone, Copy, PartialEq, poise::ChoiceParameter)]
pub enum ScopeType {
    #[name = "Include"]
    Include = 0,
    #[name = "Exclude"]
    Exclude = 1,
}

/// Scans a message against all highlight patterns in the guild and sends DM notifications.
///
/// This is the core scanning logic from `Highlights.highlightMessage()`.
pub async fn scan_message_for_highlights(
    ctx: &serenity::Context,
    data: &crate::Data,
    message: &serenity::Message,
    guild_id: serenity::GuildId,
) {
    let guild_id_str = guild_id.to_string();
    let author_id_str = message.author.id.to_string();

    // Check if highlights are enabled.
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;
    if !config.data.highlights.enabled {
        return;
    }

    // Fetch all highlights for this guild.
    let highlights = crate::lib::entities::highlight::Entity::find()
        .filter(crate::lib::entities::highlight::Column::GuildId.eq(&guild_id_str))
        .all(&data.db)
        .await;
    let highlights = match highlights {
        Ok(r) => r,
        Err(_) => return,
    };

    if highlights.is_empty() {
        return;
    }

    // Fetch all channel scoping for this guild.
    let all_scoping = crate::lib::entities::highlight_channel_scoping::Entity::find()
        .filter(crate::lib::entities::highlight_channel_scoping::Column::GuildId.eq(&guild_id_str))
        .all(&data.db)
        .await
        .unwrap_or_default();

    let content = &message.content;
    let mut formatted_content: Option<String> = None;

    let (scope_channel_id, scope_thread_id, scope_category_id) =
        resolve_highlight_scope_ids(ctx, message.channel_id).await;

    for highlight in &highlights {
        let highlight_user_id = highlight.user_id.clone();

        // Skip if the highlight owner sent the message.
        if highlight_user_id == author_id_str {
            continue;
        }

        let patterns = highlight.patterns.clone();
        if patterns.is_empty() {
            continue;
        }

        let user_blacklist = highlight.user_blacklist.clone().unwrap_or_default();

        // Check blacklist.
        if user_blacklist.contains(&author_id_str) {
            continue;
        }

        // Check channel scoping.
        let included: Vec<String> = all_scoping
            .iter()
            .filter(|s| s.user_id == highlight_user_id && s.scope_type == 0)
            .map(|s| s.channel_id.clone())
            .collect();
        let excluded: Vec<String> = all_scoping
            .iter()
            .filter(|s| s.user_id == highlight_user_id && s.scope_type == 1)
            .map(|s| s.channel_id.clone())
            .collect();

        let scoping = crate::utils::ChannelScoping { included, excluded };

        if !crate::utils::channel_in_scope_resolved(
            &scope_channel_id,
            scope_thread_id.as_deref(),
            scope_category_id.as_deref(),
            &scoping,
        ) {
            continue;
        }

        // Check pattern match.
        let matched_pattern = patterns.iter().find(|pattern| {
            get_highlight_regex(pattern)
                .and_then(|re| re.is_match(content).ok())
                .unwrap_or(false)
        });

        let Some(matched) = matched_pattern else {
            continue;
        };

        // Verify the member still has highlights permission and can view channel.
        // missing/unauthorised member does not burn a rate limit token.
        let user_id = match highlight_user_id.parse::<u64>() {
            Ok(id) => serenity::UserId::new(id),
            Err(_) => continue,
        };

        let member = match guild_id.member(ctx, user_id).await {
            Ok(member) => member,
            Err(_) => continue,
        };
        if !config.has_permission(&member, UserPermission::UseHighlights) {
            continue;
        }

        #[allow(deprecated)]
        let can_view_channel = message
            .channel_id
            .to_channel(ctx)
            .await
            .ok()
            .and_then(|c| c.guild())
            .and_then(|gc| {
                guild_id
                    .to_guild_cached(ctx)
                    .map(|guild| guild.user_permissions_in(&gc, &member).view_channel())
            })
            .unwrap_or(false);
        if !can_view_channel {
            continue;
        }

        // Rate limit check — after member/permission/channel checks, matching TS order.
        let rate_key = format!("{highlight_user_id}:{author_id_str}");
        let limit_result = HIGHLIGHT_RATE_LIMITER.limit(&rate_key).await;
        if !limit_result.success {
            continue;
        }

        // Send DM.
        let user = match user_id.to_user(ctx).await {
            Ok(u) => u,
            Err(_) => continue,
        };

        let formatted = match &formatted_content {
            Some(content) => content.clone(),
            None => {
                // TS formats the shared DM body after at least one highlight candidate matched.
                let message_link = message.link();
                let author_id_str_for_dm = message.author.id.to_string();
                let rendered = crate::utils::messages::format_message_content(
                    ctx.http.clone(),
                    crate::utils::messages::FormatMessageContentData {
                        url: Some(&message_link),
                        content: Some(content),
                        sticker_id: None,
                        author_id: Some(&author_id_str_for_dm),
                        created_at: Some(message.timestamp.unix_timestamp()),
                        include_url: true,
                    },
                )
                .await;
                formatted_content = Some(rendered.clone());
                rendered
            }
        };

        let embed = CreateEmbed::new()
            .color(0x3498DB) // Colors.Blue
            .author(
                serenity::CreateEmbedAuthor::new(format!("Message from @{}", message.author.name))
                    .icon_url(message.author.face()),
            )
            .description(formatted)
            .fields(vec![(
                format!("Pattern matched in <#{}>", message.channel_id),
                format!("`{matched}`"),
                false,
            )])
            .timestamp(serenity::Timestamp::now());

        let dm = serenity::CreateMessage::new().embed(embed);
        let _ = user.dm(ctx, dm).await;
    }
}

/// Compile and cache a highlight regex pattern using fancy-regex, which supports
/// the full JS-compatible feature set (lookaheads, lookbehinds, backreferences).
fn get_highlight_regex(pattern: &str) -> Option<fancy_regex::Regex> {
    let mut cache = REGEX_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if let Some(regex) = cache.get(pattern) {
        return Some(regex.clone());
    }

    // Build pattern: word-boundary for ASCII words, raw otherwise.
    let is_ascii_word = pattern
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '*');
    let regex_pattern = pattern.replace('*', r"(\n|\r|.)*");
    let parsed = if is_ascii_word {
        format!(r"(?i)\b({regex_pattern})\b")
    } else {
        format!(r"(?i)({regex_pattern})")
    };

    let regex = fancy_regex::Regex::new(&parsed).ok()?;
    cache.put(pattern.to_string(), regex.clone());
    Some(regex)
}

fn is_safe_highlight_pattern(pattern: &str) -> bool {
    // Valid regex is required for dynamic compilation.
    if regex::Regex::new(pattern).is_err() {
        return false;
    }

    // TS safe-regex blocks problematic repetition. Keep a strict repeat cap parity check.
    if let Ok(repeat_re) = regex::Regex::new(r"\{(\d+)(?:,\d*)?\}") {
        for caps in repeat_re.captures_iter(pattern) {
            if let Some(raw) = caps.get(1) {
                if raw.as_str().parse::<u32>().ok().is_some_and(|n| n > 25) {
                    return false;
                }
            }
        }
    }

    true
}

async fn resolve_highlight_scope_ids(
    ctx: &serenity::Context,
    channel_id: serenity::ChannelId,
) -> (String, Option<String>, Option<String>) {
    let fallback = (channel_id.to_string(), None, None);
    let Some(channel) = channel_id.to_channel(ctx).await.ok() else {
        return fallback;
    };
    let Some(guild_channel) = channel.guild() else {
        return fallback;
    };

    let is_thread = matches!(
        guild_channel.kind,
        serenity::ChannelType::PublicThread
            | serenity::ChannelType::PrivateThread
            | serenity::ChannelType::NewsThread
    );
    if !is_thread {
        return (
            guild_channel.id.to_string(),
            None,
            guild_channel.parent_id.map(|id| id.to_string()),
        );
    }

    let thread_id = guild_channel.id.to_string();
    let Some(parent_channel_id) = guild_channel.parent_id else {
        return (guild_channel.id.to_string(), Some(thread_id), None);
    };

    let category_id = match parent_channel_id
        .to_channel(ctx)
        .await
        .ok()
        .and_then(|c| c.guild())
    {
        Some(parent_channel) => parent_channel.parent_id.map(|id| id.to_string()),
        None => None,
    };

    (parent_channel_id.to_string(), Some(thread_id), category_id)
}
