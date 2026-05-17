use poise::serenity_prelude as serenity;

use crate::Data;
use crate::utils::interaction as ia;

/// Handles report search pagination buttons.
///
pub async fn handle(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
) {
    let custom_id = &interaction.data.custom_id;

    // report-search-{direction}-{controller_id}
    let parts: Vec<&str> = custom_id.split('-').collect();
    if parts.len() != 4 {
        ia::respond_error(
            ctx,
            interaction,
            "Pagination failed. Invalid pagination payload.",
        )
        .await;
        return;
    }

    let direction = parts[2];
    let controller_id = parts[3];

    if controller_id != interaction.user.id.to_string() {
        ia::respond_error(
            ctx,
            interaction,
            "Only the user who initiated the search can use these buttons.",
        )
        .await;
        return;
    }

    let _ = interaction.defer(ctx).await;

    let guild_id = match interaction.guild_id {
        Some(id) => id,
        None => return,
    };

    let config = data
        .config_manager
        .get_guild_config(&data.db, guild_id)
        .await;

    if interaction.message.embeds.is_empty() {
        ia::followup_error(
            ctx,
            interaction,
            "Pagination failed. No embed found in the message.",
        )
        .await;
        return;
    }

    let mut page_buttons = Vec::new();
    for row in &interaction.message.components {
        for component in &row.components {
            if let serenity::ActionRowComponent::Button(button) = component {
                page_buttons.push(button);
            }
        }
    }

    if page_buttons.is_empty() {
        ia::followup_error(
            ctx,
            interaction,
            "Pagination failed. No buttons found in the message.",
        )
        .await;
        return;
    }

    let page_count_button = page_buttons[page_buttons.len() / 2];
    let Some(label) = page_count_button.label.as_deref() else {
        ia::followup_error(ctx, interaction, "Pagination failed. No page info found.").await;
        return;
    };

    let split: Vec<&str> = label.split(" / ").collect();
    if split.len() != 2 {
        ia::followup_error(ctx, interaction, "Pagination failed. No page info found.").await;
        return;
    }

    let current_page = split[0].trim().parse::<i64>().unwrap_or(1);
    let total_pages = split[1].trim().parse::<i64>().unwrap_or(1);

    let new_page = match direction {
        "next" => current_page + 1,
        "back" => current_page - 1,
        "first" => 1,
        "last" => total_pages,
        _ => current_page,
    };

    let target = interaction
        .message
        .embeds
        .first()
        .and_then(|embed| embed.footer.as_ref())
        .and_then(|footer| footer.text.strip_prefix("User ID: "))
        .and_then(|id| id.parse::<u64>().ok())
        .map(serenity::UserId::new);

    let target_user = match target {
        Some(id) => id.to_user(ctx).await.ok(),
        None => None,
    };

    match crate::commands::reports::build_search_page(
        ctx,
        data,
        &config,
        guild_id,
        target_user.as_ref(),
        new_page,
        &interaction.user.id.to_string(),
    )
    .await
    {
        Ok((embed, components)) => {
            let _ = interaction
                .edit_response(
                    ctx,
                    serenity::EditInteractionResponse::new()
                        .embed(embed)
                        .components(components),
                )
                .await;
        }
        Err(message) => {
            if message == "No message reports found." {
                let _ = interaction
                    .edit_response(
                        ctx,
                        serenity::EditInteractionResponse::new()
                            .content(message)
                            .embeds(Vec::new())
                            .components(Vec::new()),
                    )
                    .await;
            } else {
                ia::followup_error(ctx, interaction, &message).await;
            }
        }
    }
}
