use poise::serenity_prelude as serenity;
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};

use crate::Data;
use crate::utils::interaction as ia;

/// Handles the User Info button.
///
/// - Fetches user, member, and ban status in parallel.
/// - Shows account created, joined server, timeout info, ban status.
/// - Shows existing report counts (pending + resolved).
pub async fn handle(
    ctx: &serenity::Context,
    interaction: &serenity::ComponentInteraction,
    data: &Data,
) {
    let custom_id = &interaction.data.custom_id;
    let user_id_str = custom_id.strip_prefix("user-info-").unwrap_or("");

    let user_id = match user_id_str.parse::<u64>() {
        Ok(id) => serenity::UserId::new(id),
        Err(_) => {
            ia::respond_error(ctx, interaction, "Invalid user info payload.").await;
            return;
        }
    };

    let guild_id = match interaction.guild_id {
        Some(id) => id,
        None => return,
    };

    // Fetch user, member, ban status in parallel.
    let (user_result, member_result, ban_result) = tokio::join!(
        user_id.to_user(ctx),
        guild_id.member(ctx, user_id),
        ctx.http.get_ban(guild_id, user_id),
    );

    let user = match user_result {
        Ok(u) => u,
        Err(_) => {
            ia::respond_error(ctx, interaction, "Failed to fetch user information.").await;
            return;
        }
    };

    let created_at = user.created_at().unix_timestamp();
    let mut embed = serenity::CreateEmbed::new()
        .color(0x23272a) // Colors.NotQuiteBlack
        .author(serenity::CreateEmbedAuthor::new(format!("@{}", user.name))
            .icon_url(user.face())
            .url(user.face()))
        .field("Account Created", format!("<t:{}:R>", created_at), true)
        .footer(serenity::CreateEmbedFooter::new(format!("User ID: {}", user.id)));

    // Add member-specific fields.
    if let Ok(ref member) = member_result {
        if let Some(joined_at) = member.joined_at {
            embed = embed.field("Joined Server", format!("<t:{}:R>", joined_at.unix_timestamp()), true);
        }

        if let Some(disabled_until) = member.communication_disabled_until {
            // Only show if the timeout is still active (mirrors isCommunicationDisabled() in djs).
            let now_unix = chrono::Utc::now().timestamp();
            if disabled_until.unix_timestamp() > now_unix {
                embed = embed.field("Timeout Expires", format!("<t:{}:R>", disabled_until.unix_timestamp()), true);
            }
        }
    }

    // Add ban info.
    // serenity's get_ban() returns Result<Option<Ban>, Error>:
    // Ok(Some(ban)) = user is banned, Ok(None) = not banned, Err = API error.
    if let Ok(Some(ref ban)) = ban_result {
        embed = embed.color(0x992D22); // DarkRed
        let reason = ban.reason.as_deref().unwrap_or("No reason provided");
        embed = embed.field("Banned", format!("{}.", reason), true);
    }

    // Fetch report counts.
    let guild_id_str = guild_id.to_string();
    let user_id_str2 = user_id.to_string();
    let guild_id_str2 = guild_id_str.clone();

    let (pending_result, resolved_result) = tokio::join!(
        crate::entities::message_report::Entity::find()
            .filter(crate::entities::message_report::Column::AuthorId.eq(user_id_str))
            .filter(crate::entities::message_report::Column::GuildId.eq(guild_id_str.clone()))
            .filter(crate::entities::message_report::Column::Status.eq(crate::entities::message_report::ReportStatus::Pending))
            .count(&data.db),
        crate::entities::message_report::Entity::find()
            .filter(crate::entities::message_report::Column::AuthorId.eq(user_id_str2))
            .filter(crate::entities::message_report::Column::GuildId.eq(guild_id_str2))
            .filter(crate::entities::message_report::Column::Status.ne(crate::entities::message_report::ReportStatus::Pending))
            .count(&data.db),
    );

    let pending: i64 = pending_result.unwrap_or(0) as i64;
    let resolved: i64 = resolved_result.unwrap_or(0) as i64;

    if pending > 0 || resolved > 0 {
        let total = pending + resolved;
        let report_word = if total == 1 { "report" } else { "reports" };
        embed = embed.field(
            "Existing Reports",
            format!("{} {} ({} pending, {} resolved).", total, report_word, pending, resolved),
            true,
        );
    }

    let _ = interaction.create_response(ctx, serenity::CreateInteractionResponse::Message(
        serenity::CreateInteractionResponseMessage::new()
            .embed(embed)
            .ephemeral(true),
    )).await;
}
