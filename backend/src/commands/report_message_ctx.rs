use crate::{Context, Error};
use poise::serenity_prelude::{self as serenity, CreateEmbed};

/// Send an ephemeral red-embed error response, matching the TS `{ error: "..." }` pattern.
async fn reply_error(ctx: Context<'_>, message: impl Into<String>) -> Result<(), Error> {
    let embed = CreateEmbed::new()
        .description(message.into())
        .color(0xED4245u32); // Colors.Red
    ctx.send(poise::CreateReply::default().embed(embed)).await?;
    Ok(())
}

/// Report a message to the server moderators (context menu command).
///
#[poise::command(context_menu_command = "Report Message", guild_only, ephemeral)]
pub async fn report_message(ctx: Context<'_>, message: serenity::Message) -> Result<(), Error> {
    let data = ctx.data();
    let Some(guild_id) = ctx.guild_id().or(message.guild_id) else {
        ctx.say("This command can only be used in a guild.").await?;
        return Ok(());
    };

    // Get config and check if reports are configured.
    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;

    if config.parse_reports_config().is_none() {
        return reply_error(
            ctx,
            "Message reports have not been configured on this server.",
        )
        .await;
    }

    // Cannot report yourself.
    if message.author.id == ctx.author().id {
        return reply_error(ctx, "You cannot report your own message.").await;
    }

    let message_id = message.id.to_string();
    let channel_id = message.channel_id.to_string();

    if config.data.message_reports.enforce_report_reason {
        let mut reason_input =
            serenity::CreateInputText::new(serenity::InputTextStyle::Paragraph, "Reason", "reason")
                .required(true)
                .max_length(1024)
                .min_length(1);

        if let Some(ref placeholder) = config.data.message_reports.placeholder_reason {
            reason_input = reason_input.value(placeholder);
        }

        let modal = serenity::CreateModal::new(
            format!("report-message-{}-{}", channel_id, message_id),
            format!("Report @{}'s Message", message.author.name),
        )
        .components(vec![serenity::CreateActionRow::InputText(reason_input)]);

        crate::utils::message_reports::cache_target_message(&message).await;

        if let poise::Context::Application(app_ctx) = ctx {
            let _ = app_ctx
                .interaction
                .create_response(
                    app_ctx.serenity_context,
                    serenity::CreateInteractionResponse::Modal(modal),
                )
                .await;
        }
        return Ok(());
    }

    ctx.defer_ephemeral().await?;

    let reason = config.data.message_reports.placeholder_reason.as_deref();
    let result = crate::utils::message_reports::upsert_report(
        ctx.serenity_context(),
        data,
        &config,
        ctx.author(),
        &message,
        Some(guild_id),
        reason,
    )
    .await;

    match result {
        Ok(_) => {
            ctx.say(format!(
                "Successfully reported <@{}>'s message, thank you for your report!",
                message.author.id
            ))
            .await?;
        }
        Err(msg) => {
            reply_error(ctx, msg).await?;
        }
    }
    Ok(())
}
