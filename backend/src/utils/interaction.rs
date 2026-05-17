//! Helpers for sending ephemeral Discord interaction responses.
//!
//! All "error" responses render a red embed and auto-delete after 7.5 seconds,

use std::sync::Arc;
use std::time::Duration;

use poise::serenity_prelude as serenity;

const AUTO_DELETE_MS: u64 = 7_500;

fn red_embed(msg: &str) -> serenity::CreateEmbed {
    serenity::CreateEmbed::new()
        .description(msg)
        .color(0xED4245u32)
}

fn schedule_delete(
    http: Arc<serenity::Http>,
    token: String,
    followup_id: Option<serenity::MessageId>,
) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(AUTO_DELETE_MS)).await;
        match followup_id {
            Some(id) => {
                let _ = http.delete_followup_message(&token, id).await;
            }
            None => {
                let _ = http.delete_original_interaction_response(&token).await;
            }
        }
    });
}

// ── Component interactions ──────────────────────────────────────────────────

/// Send an ephemeral red-embed error as the initial response (before any defer).
/// Auto-deletes after 7.5 seconds.
pub async fn respond_error(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    msg: &str,
) {
    if interaction
        .create_response(
            ctx,
            serenity::CreateInteractionResponse::Message(
                serenity::CreateInteractionResponseMessage::new()
                    .embed(red_embed(msg))
                    .ephemeral(true),
            ),
        )
        .await
        .is_ok()
    {
        schedule_delete(ctx.http.clone(), interaction.token.clone(), None);
    }
}

/// Send an ephemeral red-embed error as a followup (after defer).
/// Auto-deletes after 7.5 seconds.
pub async fn followup_error(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    msg: &str,
) {
    if let Ok(msg_obj) = interaction
        .create_followup(
            ctx,
            serenity::CreateInteractionResponseFollowup::new()
                .embed(red_embed(msg))
                .ephemeral(true),
        )
        .await
    {
        schedule_delete(
            ctx.http.clone(),
            interaction.token.clone(),
            Some(msg_obj.id),
        );
    }
}

/// Send an ephemeral plain-text success message as a followup (after defer).
/// Auto-deletes after 7.5 seconds.
pub async fn followup_success(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    content: &str,
) {
    if let Ok(msg_obj) = interaction
        .create_followup(
            ctx,
            serenity::CreateInteractionResponseFollowup::new()
                .content(content)
                .ephemeral(true),
        )
        .await
    {
        schedule_delete(
            ctx.http.clone(),
            interaction.token.clone(),
            Some(msg_obj.id),
        );
    }
}

// ── Modal interactions ──────────────────────────────────────────────────────

/// Send an ephemeral red-embed error as the initial modal response (before defer).
/// Auto-deletes after 7.5 seconds.
pub async fn modal_respond_error(
    ctx: &serenity::Context,
    modal: &serenity::ModalInteraction,
    msg: &str,
) {
    if modal
        .create_response(
            ctx,
            serenity::CreateInteractionResponse::Message(
                serenity::CreateInteractionResponseMessage::new()
                    .embed(red_embed(msg))
                    .ephemeral(true),
            ),
        )
        .await
        .is_ok()
    {
        schedule_delete(ctx.http.clone(), modal.token.clone(), None);
    }
}

/// Send an ephemeral red-embed error as a followup for a modal (after defer).
/// Auto-deletes after 7.5 seconds.
pub async fn modal_followup_error(
    ctx: &serenity::Context,
    modal: &serenity::ModalInteraction,
    msg: &str,
) {
    if let Ok(msg_obj) = modal
        .create_followup(
            ctx,
            serenity::CreateInteractionResponseFollowup::new()
                .embed(red_embed(msg))
                .ephemeral(true),
        )
        .await
    {
        schedule_delete(ctx.http.clone(), modal.token.clone(), Some(msg_obj.id));
    }
}

/// Send an ephemeral plain-text success message as a followup for a modal (after defer).
/// Auto-deletes after 7.5 seconds.
pub async fn modal_followup_success(
    ctx: &serenity::Context,
    modal: &serenity::ModalInteraction,
    content: &str,
) {
    if let Ok(msg_obj) = modal
        .create_followup(
            ctx,
            serenity::CreateInteractionResponseFollowup::new()
                .content(content)
                .ephemeral(true),
        )
        .await
    {
        schedule_delete(ctx.http.clone(), modal.token.clone(), Some(msg_obj.id));
    }
}
