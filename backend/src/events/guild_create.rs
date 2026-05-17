use poise::serenity_prelude as serenity;
use tracing::info;
use crate::Data;

/// Handles the GuildCreate event.
///
/// - Triggers guild config creation/loading.
pub async fn handle(
    guild: &serenity::Guild,
    is_new: &Option<bool>,
    data: &Data,
) {
    let _ = data.config_manager.get_guild_config(&data.db, guild.id).await;

    if is_new.unwrap_or(false) {
        info!("Joined new guild: {} ({})", guild.name, guild.id);
    }
}
