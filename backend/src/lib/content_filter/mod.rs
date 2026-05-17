//! Content Filter System
//!
//! Pipeline:
//! 1. Whitelist check
//! 2. Guild config check (enabled + webhook configured)
//! 3. Channel scoping check
//! 4. Immune role check
//! 5. Heuristic scanner (debounced, triggers background scan jobs)
//! 6. Automated scanner processes jobs: TEXT/NSFW/OCR via OpenAI
//! 7. Alert rendering → webhook + DB persistence
//! 8. Dead letter for permanently failed jobs

pub mod alert;
pub mod automated;
pub mod dead_letter;
pub mod heuristic;
pub mod scheduler;
pub mod scanner;
pub mod state;
pub mod types;

use dashmap::DashSet;
use std::sync::LazyLock;

use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter, Set};
use sea_orm::sea_query::OnConflict;
use tracing::warn;

use crate::lib::entities::content_filter_priority;

/// In-memory set of manually prioritized guild IDs.
static PRIORITIZED_GUILDS: LazyLock<DashSet<String>> = LazyLock::new(DashSet::new);

/// Returns the list of manually prioritized guild IDs.
pub fn get_prioritized_guilds() -> Vec<String> {
    PRIORITIZED_GUILDS.iter().map(|r| r.key().clone()).collect()
}

/// Checks if a guild is manually prioritized.
pub fn is_guild_prioritized(guild_id: &str) -> bool {
    PRIORITIZED_GUILDS.contains(guild_id)
}

/// Sets or removes manual guild priority.
pub async fn set_guild_priority(db: &sea_orm::DatabaseConnection, guild_id: &str, enabled: bool) {
    if enabled {
        PRIORITIZED_GUILDS.insert(guild_id.to_string());
    } else {
        PRIORITIZED_GUILDS.remove(guild_id);
    }

    if enabled {
        let model = content_filter_priority::ActiveModel {
            id: Set(guild_id.to_string()),
        };
        match content_filter_priority::Entity::insert(model)
            .on_conflict(
                OnConflict::column(content_filter_priority::Column::Id)
                    .do_nothing()
                    .to_owned(),
            )
            .exec(db)
            .await
        {
            Ok(_) | Err(DbErr::RecordNotInserted) => {}
            Err(err) => warn!(guild_id, "Failed to persist content-filter guild priority: {err}"),
        }
    } else {
        if let Err(err) = content_filter_priority::Entity::delete_many()
            .filter(content_filter_priority::Column::Id.eq(guild_id))
            .exec(db)
            .await
        {
            warn!(guild_id, "Failed to delete content-filter guild priority: {err}");
        }
    }
}

/// Loads prioritized guilds from the database on startup.
pub async fn load_prioritized_guilds(db: &sea_orm::DatabaseConnection) {
    match content_filter_priority::Entity::find().all(db).await {
        Ok(rows) => {
            for row in rows {
                PRIORITIZED_GUILDS.insert(row.id);
            }
        }
        Err(err) => warn!("Failed to load content-filter prioritized guilds: {err}"),
    }
}

/// Main entry point: scans a message through the content filter pipeline.
///
/// Called from the MessageCreate event for every non-bot message.
pub async fn scan_message(
    ctx: &poise::serenity_prelude::Context,
    data: &crate::Data,
    message: &poise::serenity_prelude::Message,
    guild_id: poise::serenity_prelude::GuildId,
) {
    let guild_id_str = guild_id.to_string();

    // 1. Whitelist check.
    if !crate::utils::is_guild_whitelisted(&data.db, &data.kv, &guild_id_str).await {
        return;
    }

    // 2. Guild config check.
    let config = data.config_manager.get_guild_config(&data.db, guild_id).await;
    let cf_config = match config.parse_content_filter_config() {
        Some(c) => c,
        None => return,
    };

    if !cf_config.config.enabled || cf_config.config.webhook_url.is_none() {
        return;
    }

    // Cache the message for content filter scanners.
    automated::cache_message(message);

    let serialized = crate::lib::repository::messages::MessageManager::serialize(message, &ctx.cache);

    automated::enqueue_for_scan(
        ctx,
        message,
        &config,
        &serialized,
    ).await;

    if cf_config.config.use_heuristic_scanner {
        heuristic::trigger_scan(
            message,
            &config,
            data.clone(),
            ctx.clone(),
        ).await;
    }
}

/// Starts the automated scanner background task.
pub fn start_automated_scanner(
    data: crate::Data,
    ctx: poise::serenity_prelude::Context,
) {
    automated::start(data, ctx);
}
