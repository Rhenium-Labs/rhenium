use poise::serenity_prelude as serenity;
use tracing::error;

use crate::Data;

/// Handles the InteractionCreate event.
///
/// - Routes component interactions (buttons) to component handlers.
/// - Routes modal submissions to modal handlers.
/// - Slash commands are handled by poise automatically.
///
/// - "Not found": captured to Sentry + ephemeral error reply (create_response).
/// - Handler panic (unexpected failure): captured to Sentry + ephemeral reply via
///   followUp if already deferred/replied, otherwise create_response.
///
/// # Panic handling
///
/// `std::panic::catch_unwind` does NOT work for async code — it only wraps the
/// synchronous creation of the future, not its execution. Panics inside the
/// async handler body propagate past `catch_unwind` and unwind up to the tokio
/// task boundary.
///
/// Instead we use `tokio::task::spawn` which runs the future in a new task.
/// A panicking task produces a `JoinError` with `is_panic() == true`, which we
/// detect and report just like the TS `try/catch` around the handler call.
pub async fn handle(ctx: &serenity::Context, interaction: &serenity::Interaction, data: &Data) {
    match interaction {
        serenity::Interaction::Component(component) => {
            let ctx2 = ctx.clone();
            let component2 = component.clone();
            let data2 = data.clone();

            let join_result = tokio::task::spawn(async move {
                crate::components::handle_component(&ctx2, &component2, &data2).await
            })
            .await;

            match join_result {
                Err(join_err) if join_err.is_panic() => {
                    // Handler panicked — equivalent to TS throwing an uncaught exception.
                    let panic_payload = join_err.into_panic();
                    let msg = panic_payload
                        .downcast_ref::<&str>()
                        .copied()
                        .or_else(|| panic_payload.downcast_ref::<String>().map(String::as_str))
                        .unwrap_or("unknown panic");

                    let sentry_id = sentry::capture_message(
                        &format!(
                            "Component '{}' handler panicked: {}",
                            component.data.custom_id, msg
                        ),
                        sentry::Level::Error,
                    );
                    error!(
                        "Component '{}' handler panicked: {}",
                        component.data.custom_id, msg
                    );
                    send_error_reply_component(ctx, component, sentry_id).await;
                }
                Err(_) => {
                    // Task was cancelled — nothing to report.
                }
                Ok(handled) => {
                    if !handled {
                        // No handler registered for this custom_id.
                        let sentry_id = sentry::capture_message(
                            &format!(
                                "Component '{}' not found in store.",
                                component.data.custom_id
                            ),
                            sentry::Level::Error,
                        );
                        send_error_reply_component(ctx, component, sentry_id).await;
                    }
                }
            }
        }
        serenity::Interaction::Modal(modal) => {
            let ctx2 = ctx.clone();
            let modal2 = modal.clone();
            let data2 = data.clone();

            let join_result = tokio::task::spawn(async move {
                crate::components::handle_modal(&ctx2, &modal2, &data2).await
            })
            .await;

            match join_result {
                Err(join_err) if join_err.is_panic() => {
                    let panic_payload = join_err.into_panic();
                    let msg = panic_payload
                        .downcast_ref::<&str>()
                        .copied()
                        .or_else(|| panic_payload.downcast_ref::<String>().map(String::as_str))
                        .unwrap_or("unknown panic");

                    let sentry_id = sentry::capture_message(
                        &format!("Modal '{}' handler panicked: {}", modal.data.custom_id, msg),
                        sentry::Level::Error,
                    );
                    error!("Modal '{}' handler panicked: {}", modal.data.custom_id, msg);
                    send_error_reply_modal(ctx, modal, sentry_id).await;
                }
                Err(_) => {
                    // Task was cancelled — nothing to report.
                }
                Ok(handled) => {
                    if !handled {
                        let sentry_id = sentry::capture_message(
                            &format!("Modal '{}' not found in store.", modal.data.custom_id),
                            sentry::Level::Error,
                        );
                        send_error_reply_modal(ctx, modal, sentry_id).await;
                    }
                }
            }
        }
        _ => {}
    }
}

/// Send an ephemeral error reply for a component interaction.
///
/// Mirrors TS: `interaction.deferred || interaction.replied ? followUp : reply`
async fn send_error_reply_component(
    ctx: &serenity::Context,
    component: &serenity::ComponentInteraction,
    sentry_id: sentry::types::Uuid,
) {
    let content = format!(
        "An error occurred while executing this interaction. Please use this ID when reporting the bug: `{}`.",
        sentry_id
    );
    // Component interactions are either deferred, replied, or neither.
    // We check by trying create_response first; if that fails (already responded),
    // fall back to create_followup — matching TS `deferred || replied ? followUp : reply`.
    if component
        .create_response(
            ctx,
            serenity::CreateInteractionResponse::Message(
                serenity::CreateInteractionResponseMessage::new()
                    .content(&content)
                    .ephemeral(true),
            ),
        )
        .await
        .is_err()
    {
        let _ = component
            .create_followup(
                ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content(content)
                    .ephemeral(true),
            )
            .await;
    }
}

/// Send an ephemeral error reply for a modal interaction.
///
/// Mirrors TS: `interaction.deferred || interaction.replied ? followUp : reply`
async fn send_error_reply_modal(
    ctx: &serenity::Context,
    modal: &serenity::ModalInteraction,
    sentry_id: sentry::types::Uuid,
) {
    let content = format!(
        "An error occurred while executing this interaction. Please use this ID when reporting the bug: `{}`.",
        sentry_id
    );
    if modal
        .create_response(
            ctx,
            serenity::CreateInteractionResponse::Message(
                serenity::CreateInteractionResponseMessage::new()
                    .content(&content)
                    .ephemeral(true),
            ),
        )
        .await
        .is_err()
    {
        let _ = modal
            .create_followup(
                ctx,
                serenity::CreateInteractionResponseFollowup::new()
                    .content(content)
                    .ephemeral(true),
            )
            .await;
    }
}
