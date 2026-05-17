//! Component handler module.
//!
//! Each component has its own submodule matching the TS source structure:

pub mod ban_request_button;
pub mod ban_request_deny_modal;
pub mod content_filter_button;
pub mod delete_report_message;
pub mod message_report_button;
pub mod report_message_modal;
pub mod report_search_pagination;
pub mod user_info;

use crate::Data;
use poise::serenity_prelude as serenity;

/// Routes button/select menu component interactions to the appropriate handler.
pub async fn handle_component(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
) -> bool {
    let custom_id = &interaction.data.custom_id;

    if custom_id.starts_with("ban-request-") {
        ban_request_button::handle(ctx, interaction, data).await;
        true
    } else if custom_id.starts_with("message-report-") {
        message_report_button::handle(ctx, interaction, data).await;
        true
    } else if custom_id.starts_with("delete-original-report-message-")
        || custom_id.starts_with("delete-reference-report-message-")
    {
        delete_report_message::handle(ctx, interaction, data).await;
        true
    } else if custom_id.starts_with("user-info-") {
        user_info::handle(ctx, interaction, data).await;
        true
    } else if custom_id.starts_with("cfb1:") {
        content_filter_button::handle(ctx, interaction, data).await;
        true
    } else if custom_id.starts_with("report-search-") {
        report_search_pagination::handle(ctx, interaction, data).await;
        true
    } else {
        false
    }
}

/// Routes modal submission interactions to the appropriate handler.
pub async fn handle_modal(
    ctx: &serenity::Context,
    modal: &serenity::ModalInteraction,
    data: &Data,
) -> bool {
    let custom_id = &modal.data.custom_id;

    if custom_id.starts_with("report-message-") {
        report_message_modal::handle(ctx, modal, data).await;
        true
    } else if custom_id.starts_with("ban-request-deny-") {
        ban_request_deny_modal::handle(ctx, modal, data).await;
        true
    } else {
        false
    }
}
