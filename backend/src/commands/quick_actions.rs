use poise::serenity_prelude::{self as serenity, CreateEmbed};
use regex::Regex;
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, Set};

use crate::{Context, Error};

/// Send an ephemeral red-embed error response, matching the TS `{ error: "..." }` pattern.
async fn reply_error(ctx: Context<'_>, message: impl Into<String>) -> Result<(), Error> {
    let embed = CreateEmbed::new()
        .description(message.into())
        .color(0xED4245u32); // Colors.Red
    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// Manage your quick action reactions.
///
#[poise::command(
    slash_command,
    guild_only,
    default_member_permissions = "MODERATE_MEMBERS",
    subcommands("mutes", "purges")
)]
pub async fn quick(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Manage your quick mute reactions.
#[poise::command(
    slash_command,
    rename = "mutes",
    subcommands("mutes_add", "mutes_remove", "mutes_list", "mutes_clear")
)]
pub async fn mutes(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Manage your quick purge reactions.
#[poise::command(
    slash_command,
    rename = "purges",
    subcommands("purges_add", "purges_remove", "purges_list", "purges_clear")
)]
pub async fn purges(_ctx: Context<'_>) -> Result<(), Error> {
    Ok(())
}

/// Add a quick mute reaction.
#[poise::command(slash_command, rename = "add", ephemeral)]
pub async fn mutes_add(
    ctx: Context<'_>,
    #[description = "The emoji to use as a reaction trigger"] reaction: String,
    #[description = "The duration for the mute (e.g., 10m, 1h, 1d)"] duration: String,
    #[description = "The reason for the mute"]
    #[max_length = 1024]
    reason: String,
    #[description = "Number of messages to purge (0 = none, default: 0)"]
    #[min = 0]
    #[max = 100]
    purge_amount: Option<i32>,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();
    let purge_amount = purge_amount.unwrap_or(0);

    let guild_config = data
        .config_manager
        .get_guild_config(&data.db, guild_id_obj)
        .await;
    let Some(_mute_cfg) = guild_config.parse_quick_mutes_config() else {
        return reply_error(ctx, "Quick mutes have not been configured on this server.").await;
    };

    // Hardcoded limit of 10 quick mutes per user.
    use crate::lib::entities::quick_mute::Column;
    let count = crate::lib::entities::quick_mute::Entity::find()
        .filter(Column::UserId.eq(user_id.clone()))
        .filter(Column::GuildId.eq(guild_id.clone()))
        .count(&data.db)
        .await
        .unwrap_or(0);
    if count >= 10 {
        return reply_error(ctx, "You have reached the maximum of 10 quick mutes. Please remove an existing one before adding a new one.").await;
    }

    let validated_emoji =
        validate_quick_action_emoji(ctx.serenity_context(), guild_id_obj, &reaction).await;
    let Some(validated_emoji) = validated_emoji else {
        return reply_error(ctx, "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server.").await;
    };
    let emoji_id = validated_emoji.identifier();

    // Check if already exists.
    let exists = crate::lib::entities::quick_mute::Entity::find()
        .filter(Column::UserId.eq(user_id.clone()))
        .filter(Column::GuildId.eq(guild_id.clone()))
        .filter(Column::Reaction.eq(emoji_id.clone()))
        .one(&data.db)
        .await?
        .is_some();
    if exists {
        return reply_error(ctx, "You already have a quick mute configured for this reaction. Remove it first to add a new one.").await;
    }

    // Parse and validate duration.
    let duration_ms = crate::utils::parse_duration_string(&duration);
    let Some(duration_ms) = duration_ms else {
        return reply_error(
            ctx,
            "Invalid duration format. Please use formats like `10m`, `1h`, `1d`.",
        )
        .await;
    };

    if let Err(msg) = crate::utils::validate_duration(duration_ms, "5s", "28d") {
        return reply_error(ctx, msg).await;
    }

    if purge_amount > guild_config.data.quick_purges.max_limit as i32 {
        return reply_error(
            ctx,
            format!(
                "The maximum purge amount for this server is `{}` messages.",
                guild_config.data.quick_purges.max_limit
            ),
        )
        .await;
    }

    // Insert.
    crate::lib::entities::quick_mute::Entity::insert(
        crate::lib::entities::quick_mute::ActiveModel {
            user_id: Set(user_id),
            guild_id: Set(guild_id),
            reaction: Set(emoji_id),
            duration: Set(duration_ms as i64),
            reason: Set(reason.clone()),
            purge_amount: Set(purge_amount),
        },
    )
    .exec(&data.db)
    .await?;

    let formatted = crate::utils::format_duration_ms(duration_ms);
    ctx.say(format!(
        "Successfully added quick mute: {} → **{formatted}**{}\nReason: `{reason}`",
        validated_emoji.display(),
        if purge_amount > 0 {
            format!(" + purge {purge_amount} messages")
        } else {
            String::new()
        }
    ))
    .await?;
    Ok(())
}

/// Remove a quick mute reaction.
#[poise::command(slash_command, rename = "remove", ephemeral)]
pub async fn mutes_remove(
    ctx: Context<'_>,
    #[description = "The emoji reaction to remove"] reaction: String,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();
    let validated_emoji =
        validate_quick_action_emoji(ctx.serenity_context(), guild_id_obj, &reaction).await;
    let Some(validated_emoji) = validated_emoji else {
        return reply_error(ctx, "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server.").await;
    };
    let emoji_id = validated_emoji.identifier();

    use crate::lib::entities::quick_mute::Column;
    let result = crate::lib::entities::quick_mute::Entity::delete_many()
        .filter(Column::UserId.eq(user_id))
        .filter(Column::GuildId.eq(guild_id))
        .filter(Column::Reaction.eq(emoji_id))
        .exec(&data.db)
        .await?;

    if result.rows_affected == 0 {
        return reply_error(
            ctx,
            "You don't have a quick mute configured for this reaction.",
        )
        .await;
    } else {
        ctx.say(format!(
            "Successfully removed quick mute for {}.",
            validated_emoji.display()
        ))
        .await?;
    }
    Ok(())
}

/// List your quick mute reactions.
#[poise::command(slash_command, rename = "list", ephemeral)]
pub async fn mutes_list(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    use crate::lib::entities::quick_mute::Column;
    let rows = crate::lib::entities::quick_mute::Entity::find()
        .filter(Column::UserId.eq(user_id))
        .filter(Column::GuildId.eq(guild_id))
        .all(&data.db)
        .await?;

    if rows.is_empty() {
        ctx.say("You don't have any quick mutes configured.")
            .await?;
        return Ok(());
    }

    let fields = {
        let cached_emojis = cached_emoji_map(ctx.guild().as_deref());
        let mut fields = Vec::new();
        for row in rows.iter() {
            let reaction_display = display_emoji(
                ctx.serenity_context(),
                guild_id_obj,
                &row.reaction,
                &cached_emojis,
            )
            .await;

            let formatted = crate::utils::format_duration_ms(row.duration as u64);
            let safe_reason = crate::utils::messages::escape_code_block(&row.reason);
            fields.push((
                reaction_display,
                format!(
                    "→ **{}**{}\n└ `{}`",
                    formatted,
                    if row.purge_amount > 0 {
                        format!(" + purge {}", row.purge_amount)
                    } else {
                        String::new()
                    },
                    crate::utils::truncate(&safe_reason, 256)
                ),
                false,
            ));
        }
        fields
    };

    let embed = CreateEmbed::new()
        .color(0x23272a) // Colors.NotQuiteBlack
        .author(
            serenity::CreateEmbedAuthor::new(format!(
                "Quick Mute Configs for @{}",
                ctx.author().name
            ))
            .icon_url(ctx.author().face()),
        )
        .fields(fields)
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// Clear all your quick mute reactions.
#[poise::command(slash_command, rename = "clear", ephemeral)]
pub async fn mutes_clear(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    use crate::lib::entities::quick_mute::Column;
    let result = crate::lib::entities::quick_mute::Entity::delete_many()
        .filter(Column::UserId.eq(user_id))
        .filter(Column::GuildId.eq(guild_id))
        .exec(&data.db)
        .await?;
    let deleted = result.rows_affected;

    if deleted == 0 {
        ctx.say("You don't have any quick mutes to clear.").await?;
        return Ok(());
    }

    ctx.say(format!(
        "Successfully cleared `{}` {}.",
        deleted,
        crate::utils::inflect(deleted, "quick mute")
    ))
    .await?;
    Ok(())
}

/// Add a quick purge reaction.
#[poise::command(slash_command, rename = "add", ephemeral)]
pub async fn purges_add(
    ctx: Context<'_>,
    #[description = "The emoji to use as a reaction trigger"] reaction: String,
    #[description = "Number of messages to purge"]
    #[min = 1]
    #[max = 100]
    amount: i32,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    let guild_config = data
        .config_manager
        .get_guild_config(&data.db, guild_id_obj)
        .await;
    let Some(purge_cfg) = guild_config.parse_quick_purges_config() else {
        return reply_error(ctx, "Quick purges have not been configured on this server.").await;
    };

    use crate::lib::entities::quick_purge::Column;
    let count = crate::lib::entities::quick_purge::Entity::find()
        .filter(Column::UserId.eq(user_id.clone()))
        .filter(Column::GuildId.eq(guild_id.clone()))
        .count(&data.db)
        .await
        .unwrap_or(0);
    if count >= 10 {
        return reply_error(ctx, "You have reached the maximum of 10 quick purges. Please remove an existing one before adding a new one.").await;
    }

    let validated_emoji =
        validate_quick_action_emoji(ctx.serenity_context(), guild_id_obj, &reaction).await;
    let Some(validated_emoji) = validated_emoji else {
        return reply_error(ctx, "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server.").await;
    };
    let emoji_id = validated_emoji.identifier();

    // Check if already exists.
    let exists = crate::lib::entities::quick_purge::Entity::find()
        .filter(Column::UserId.eq(user_id.clone()))
        .filter(Column::GuildId.eq(guild_id.clone()))
        .filter(Column::Reaction.eq(emoji_id.clone()))
        .one(&data.db)
        .await?
        .is_some();
    if exists {
        return reply_error(ctx, "You already have a quick purge configured for this reaction. Remove it first to add a new one.").await;
    }

    if amount > purge_cfg.max_limit as i32 {
        return reply_error(
            ctx,
            format!(
                "The maximum purge amount for this server is `{}` messages.",
                purge_cfg.max_limit
            ),
        )
        .await;
    }

    crate::lib::entities::quick_purge::Entity::insert(
        crate::lib::entities::quick_purge::ActiveModel {
            user_id: Set(user_id),
            guild_id: Set(guild_id),
            reaction: Set(emoji_id),
            purge_amount: Set(amount),
        },
    )
    .exec(&data.db)
    .await?;

    ctx.say(format!(
        "Successfully added quick purge: {} → purge **{amount}** {}",
        validated_emoji.display(),
        crate::utils::inflect(amount as u64, "message")
    ))
    .await?;
    Ok(())
}

/// Remove a quick purge reaction.
#[poise::command(slash_command, rename = "remove", ephemeral)]
pub async fn purges_remove(
    ctx: Context<'_>,
    #[description = "The emoji reaction to remove"] reaction: String,
) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();
    let validated_emoji =
        validate_quick_action_emoji(ctx.serenity_context(), guild_id_obj, &reaction).await;
    let Some(validated_emoji) = validated_emoji else {
        return reply_error(ctx, "Invalid emoji. Please provide a valid unicode emoji or a custom emoji from this server.").await;
    };
    let emoji_id = validated_emoji.identifier();

    use crate::lib::entities::quick_purge::Column;
    let result = crate::lib::entities::quick_purge::Entity::delete_many()
        .filter(Column::UserId.eq(user_id))
        .filter(Column::GuildId.eq(guild_id))
        .filter(Column::Reaction.eq(emoji_id))
        .exec(&data.db)
        .await?;

    if result.rows_affected == 0 {
        return reply_error(
            ctx,
            "You don't have a quick purge configured for this reaction.",
        )
        .await;
    } else {
        ctx.say(format!(
            "Successfully removed quick purge for {}.",
            validated_emoji.display()
        ))
        .await?;
    }
    Ok(())
}

/// List your quick purge reactions.
#[poise::command(slash_command, rename = "list", ephemeral)]
pub async fn purges_list(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    use crate::lib::entities::quick_purge::Column;
    let rows = crate::lib::entities::quick_purge::Entity::find()
        .filter(Column::UserId.eq(user_id))
        .filter(Column::GuildId.eq(guild_id))
        .all(&data.db)
        .await?;

    if rows.is_empty() {
        ctx.say("You don't have any quick purges configured.")
            .await?;
        return Ok(());
    }

    let fields = {
        let cached_emojis = cached_emoji_map(ctx.guild().as_deref());
        let mut fields = Vec::new();
        for row in rows.iter() {
            let reaction_display = display_emoji(
                ctx.serenity_context(),
                guild_id_obj,
                &row.reaction,
                &cached_emojis,
            )
            .await;
            fields.push((
                reaction_display,
                format!(
                    "→ purge **{}** {}",
                    row.purge_amount,
                    crate::utils::inflect(row.purge_amount as u64, "message")
                ),
                false,
            ));
        }
        fields
    };

    let embed = CreateEmbed::new()
        .color(0x23272a) // Colors.NotQuiteBlack
        .author(
            serenity::CreateEmbedAuthor::new(format!(
                "Quick Purge Configs for @{}",
                ctx.author().name
            ))
            .icon_url(ctx.author().face()),
        )
        .fields(fields)
        .timestamp(serenity::Timestamp::now());

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// Clear all your quick purge reactions.
#[poise::command(slash_command, rename = "clear", ephemeral)]
pub async fn purges_clear(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id_obj) = ctx.guild_id() else {
        return Ok(());
    };
    let guild_id = guild_id_obj.to_string();
    let user_id = ctx.author().id.to_string();

    use crate::lib::entities::quick_purge::Column;
    let result = crate::lib::entities::quick_purge::Entity::delete_many()
        .filter(Column::UserId.eq(user_id))
        .filter(Column::GuildId.eq(guild_id))
        .exec(&data.db)
        .await?;
    let deleted = result.rows_affected;

    if deleted == 0 {
        ctx.say("You don't have any quick purges to clear.").await?;
        return Ok(());
    }

    ctx.say(format!(
        "Successfully cleared `{}` {}.",
        deleted,
        crate::utils::inflect(deleted, "quick purge")
    ))
    .await?;
    Ok(())
}

async fn display_emoji(
    ctx: &serenity::Context,
    guild_id: serenity::GuildId,
    reaction: &str,
    cached_emojis: &std::collections::HashMap<u64, (String, bool)>,
) -> String {
    let unicode_re = Regex::new(
        r"(?:\p{Extended_Pictographic}(?:\u{FE0F}|\u{FE0E})?(?:\u{200D}(?:\p{Extended_Pictographic}(?:\u{FE0F}|\u{FE0E})?))*)",
    );
    if unicode_re
        .as_ref()
        .ok()
        .and_then(|re| re.find(reaction))
        .is_some()
    {
        return reaction.to_string();
    }

    if let Ok(id) = reaction.parse::<u64>() {
        if let Some((name, animated)) = cached_emojis.get(&id) {
            return if *animated {
                format!("<a:{name}:{id}>")
            } else {
                format!("<:{name}:{id}>")
            };
        }
    }

    if let Ok(id) = reaction.parse::<u64>() {
        let emoji_id = serenity::EmojiId::new(id);
        if let Ok(emojis) = guild_id.emojis(ctx).await {
            if let Some(emoji) = emojis.into_iter().find(|emoji| emoji.id == emoji_id) {
                return if emoji.animated {
                    format!("<a:{}:{}>", emoji.name, emoji.id)
                } else {
                    format!("<:{}:{}>", emoji.name, emoji.id)
                };
            }
        }
    }

    "unknown".to_string()
}

fn cached_emoji_map(
    guild: Option<&serenity::Guild>,
) -> std::collections::HashMap<u64, (String, bool)> {
    guild
        .map(|guild| {
            guild
                .emojis
                .iter()
                .map(|(id, emoji)| (id.get(), (emoji.name.clone(), emoji.animated)))
                .collect()
        })
        .unwrap_or_default()
}

enum ValidatedQuickActionEmoji {
    Unicode(String),
    Custom { id: String, name: String },
}

impl ValidatedQuickActionEmoji {
    fn identifier(&self) -> String {
        match self {
            Self::Unicode(name) => name.clone(),
            Self::Custom { id, .. } => id.clone(),
        }
    }

    fn display(&self) -> String {
        match self {
            Self::Unicode(name) => name.clone(),
            // (TS uses `validatedEmoji.id ? \`<:${name}:${id}>\` : name`).
            Self::Custom { id, name, .. } => format!("<:{name}:{id}>"),
        }
    }
}

async fn validate_quick_action_emoji(
    ctx: &serenity::Context,
    guild_id: serenity::GuildId,
    input: &str,
) -> Option<ValidatedQuickActionEmoji> {
    // TS validateEmoji checks the unanchored unicode regex before custom emoji parsing.
    let unicode_re = Regex::new(
        r"(?:\p{Extended_Pictographic}(?:\u{FE0F}|\u{FE0E})?(?:\u{200D}(?:\p{Extended_Pictographic}(?:\u{FE0F}|\u{FE0E})?))*)",
    )
    .ok()?;
    if let Some(mat) = unicode_re.find(input) {
        return Some(ValidatedQuickActionEmoji::Unicode(mat.as_str().to_string()));
    }

    let custom_re = Regex::new(r"<a?:([a-zA-Z0-9_]+):(\d{17,19})>").ok()?;
    if let Some(caps) = custom_re.captures(input) {
        let name = caps.get(1)?.as_str().to_string();
        let id = caps.get(2)?.as_str().to_string();
        let id_u64 = id.parse::<u64>().ok()?;

        let emoji_id = serenity::EmojiId::new(id_u64);
        let cached = guild_id
            .to_guild_cached(ctx)
            .map(|guild| guild.emojis.contains_key(&emoji_id))
            .unwrap_or(false);
        if cached {
            return Some(ValidatedQuickActionEmoji::Custom { id, name });
        }

        let fetched = guild_id
            .emojis(ctx)
            .await
            .ok()
            .map(|emojis| emojis.into_iter().any(|emoji| emoji.id == emoji_id))
            .unwrap_or(false);
        if fetched {
            return Some(ValidatedQuickActionEmoji::Custom { id, name });
        }
        return None;
    }
    None
}
