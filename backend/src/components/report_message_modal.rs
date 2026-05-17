use crate::Data;
use crate::utils::interaction as ia;
use poise::serenity_prelude as serenity;

/// Handles the report message modal submission.
///
/// - Validates the report reason.
/// - Creates or updates the message report via the upsert logic.
pub async fn handle(ctx: &serenity::Context, modal: &serenity::ModalInteraction, data: &Data) {
    let guild_id = match modal.guild_id {
        Some(id) => id,
        None => return,
    };

    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;

    if config.parse_reports_config().is_none() {
        ia::modal_respond_error(
            ctx,
            modal,
            "Message reports have not been configured on this server.",
        )
        .await;
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

    // Parse message_id from custom_id: "report-message-{channel_id}-{message_id}"
    let parts: Vec<&str> = modal.data.custom_id.split('-').collect();
    if parts.len() < 4 {
        ia::modal_followup_error(ctx, modal, "Failed to parse report payload.").await;
        return;
    }
    let message_id_str = parts[3];

    // Fetch the target message (prefer cached target from context menu).
    // TS checks cache BEFORE validating reason, matching this order.
    let cached = crate::utils::message_reports::get_cached_target_message(message_id_str).await;
    let Some(message) = cached else {
        ia::modal_followup_error(
            ctx,
            modal,
            &format!("Failed to get the message with ID {}.", message_id_str),
        )
        .await;
        return;
    };

    // Get the reason from the modal.
    let report_reason = modal
        .data
        .components
        .first()
        .and_then(|row| row.components.first())
        .and_then(|c| match c {
            serenity::ActionRowComponent::InputText(input) => input.value.clone(),
            _ => None,
        })
        .unwrap_or_default();

    if !report_reason
        .chars()
        .any(|c| c.is_alphanumeric() || c == '_')
    {
        ia::modal_followup_error(
            ctx,
            modal,
            "You must provide a valid reason for reporting this message.",
        )
        .await;
        return;
    }

    handle_report_with_message(ctx, modal, data, &config, message, report_reason).await;
    crate::utils::message_reports::remove_cached_target_message(message_id_str).await;
}

async fn handle_report_with_message(
    ctx: &serenity::Context,
    modal: &serenity::ModalInteraction,
    data: &Data,
    config: &crate::lib::config::guild::GuildConfig,
    message: serenity::Message,
    report_reason: String,
) {
    let guild_id = message.guild_id.or(modal.guild_id).or(Some(config.id));

    // upsert_report handles all validation (blacklist, immune, bot/system, duplicates).
    let result = crate::utils::message_reports::upsert_report(
        ctx,
        data,
        config,
        &modal.user,
        &message,
        guild_id.or(modal.guild_id),
        Some(&report_reason),
    )
    .await;

    match result {
        Ok(_) => {
            let _ = modal
                .create_followup(
                    ctx,
                    serenity::CreateInteractionResponseFollowup::new()
                        .content(format!(
                            "Successfully reported <@{}>'s message, thank you for your report!",
                            message.author.id,
                        ))
                        .ephemeral(true),
                )
                .await;
        }
        Err(msg) => {
            ia::modal_followup_error(ctx, modal, &msg).await;
        }
    }
}
