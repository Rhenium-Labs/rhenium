use poise::serenity_prelude::{CreateEmbed, CreateAttachment, CreateActionRow, CreateButton};
use sea_orm::{EntityTrait, Set};
use crate::{Context, Error};

/// Developer-only command: manage AI content filter whitelist.
///
#[poise::command(prefix_command, hide_in_help, aliases("wl"))]
pub async fn whitelist(
    ctx: Context<'_>,
    #[description = "Subcommand: create, delete, check, list"] subcommand: Option<String>,
    #[description = "Guild ID"] guild_id: Option<String>,
) -> Result<(), Error> {
    let data = ctx.data();

    // Developer check.
    if !data.global_config.is_developer(&ctx.author().id.to_string()) {
        ctx.say("You do not have permission to use this command.")
            .await?;
        return Ok(());
    }

    let Some(subcommand_raw) = subcommand else {
        ctx.say("You must specify a subcommand: create, delete, check, list (for content-filter whitelist entries).")
            .await?;
        return Ok(());
    };

    if subcommand_raw.trim().is_empty() {
        ctx.say("You must specify a subcommand: create, delete, check, list (for content-filter whitelist entries).")
            .await?;
        return Ok(());
    }

    let subcommand = subcommand_raw.to_lowercase();
    match subcommand.as_str() {
        "list" => whitelist_list(ctx).await,
        "create" => {
            let Some(gid) = guild_id else {
                ctx.say("You must provide the ID of a guild to create an entry for.")
                    .await?;
                return Ok(());
            };
            whitelist_create(ctx, &gid).await
        }
        "delete" => {
            let Some(gid) = guild_id else {
                ctx.say("You must provide the ID of a guild to delete an entry for.")
                    .await?;
                return Ok(());
            };
            whitelist_delete(ctx, &gid).await
        }
        "check" => {
            let Some(gid) = guild_id else {
                ctx.say("You must provide the ID of a guild to check an entry for.")
                    .await?;
                return Ok(());
            };
            whitelist_check(ctx, &gid).await
        }
        _ => {
            ctx.say(format!(
                "Invalid subcommand `{}`. Valid subcommands are: create, delete, check, list.",
                subcommand
            ))
                .await?;
            Ok(())
        }
    }
}

async fn whitelist_create(ctx: Context<'_>, guild_id: &str) -> Result<(), Error> {
    let data = ctx.data();

    // Check if already whitelisted.
    let exists = crate::entities::whitelist::Entity::find_by_id(guild_id)
        .one(&data.db)
        .await?
        .is_some();

    if exists {
        // Ensure KV reflects the DB truth (may be stale false from a prior delete).
        let _ = data
            .kv
            .put(&format!("whitelists:{guild_id}"), &crate::utils::WhitelistCacheEntry { status: true });
        ctx.say(format!(
            "Guild with ID `{guild_id}` is already whitelisted for the AI content filter system."
        ))
        .await?;
        return Ok(());
    }

    // Insert.
    crate::entities::whitelist::Entity::insert(crate::entities::whitelist::ActiveModel {
        id: Set(guild_id.to_string()),
        ..Default::default()
    })
    .exec(&data.db)
    .await?;

    // Update KV cache.
    let _ = data
        .kv
        .put(&format!("whitelists:{guild_id}"), &crate::utils::WhitelistCacheEntry { status: true });

    let embed = CreateEmbed::new()
        .description(format!(
            "Successfully whitelisted guild with ID `{guild_id}` for the AI content filter system."
        ))
        .color(0x57F287); // Green

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

async fn whitelist_delete(ctx: Context<'_>, guild_id: &str) -> Result<(), Error> {
    let data = ctx.data();

    let exists = crate::entities::whitelist::Entity::find_by_id(guild_id)
        .one(&data.db)
        .await?
        .is_some();

    if !exists {
        ctx.say(format!(
            "Guild with ID `{guild_id}` is not whitelisted for the AI content filter system."
        ))
        .await?;
        return Ok(());
    }

    crate::entities::whitelist::Entity::delete_by_id(guild_id)
        .exec(&data.db)
        .await?;

    let _ = data
        .kv
        .delete(&format!("whitelists:{guild_id}"));

    let embed = CreateEmbed::new()
        .description(format!(
            "Successfully removed guild with ID `{guild_id}` from the AI content filter whitelist."
        ))
        .color(0x57F287);

    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

async fn whitelist_check(ctx: Context<'_>, guild_id: &str) -> Result<(), Error> {
    let data = ctx.data();

    let is_whitelisted = crate::utils::is_guild_whitelisted(&data.db, &data.kv, guild_id).await;

    let (desc, color) = if is_whitelisted {
        (
            format!("Guild with ID `{guild_id}` is whitelisted for the AI content filter system."),
            0x57F287u32, // Green
        )
    } else {
        (
            format!("Guild with ID `{guild_id}` is not whitelisted for the AI content filter system."),
            0x3498DBu32, // Colors.Blue
        )
    };

    let embed = CreateEmbed::new().description(desc).color(color);
    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

async fn whitelist_list(ctx: Context<'_>) -> Result<(), Error> {
    let data = ctx.data();

    let rows = crate::entities::whitelist::Entity::find()
        .all(&data.db)
        .await?;

    if rows.is_empty() {
        let embed = CreateEmbed::new()
            .description("There are no entries in the AI content filter whitelist.")
            .color(0x3498DB); // Colors.Blue
        ctx.send(poise::CreateReply::default().embed(embed)).await?;
        return Ok(());
    }

    let content: String = rows
        .iter()
        .map(|row| format!("- {}", row.id))
        .collect::<Vec<_>>()
        .join("\n");

    let attachment = CreateAttachment::bytes(content.as_bytes().to_vec(), "whitelist.txt");

    // Try uploading to hastebin for a browser link.
    let hastebin_url = crate::utils::hastebin(&content, "txt").await;

    let mut reply = poise::CreateReply::default()
        .content("Below contains every entry in the AI content filter whitelist.")
        .attachment(attachment);

    if let Some(url) = hastebin_url {
        let button = CreateButton::new_link(url)
            .label("Open In Browser");
        reply = reply.components(vec![CreateActionRow::Buttons(vec![button])]);
    }

    ctx.send(reply).await?;
    Ok(())
}
