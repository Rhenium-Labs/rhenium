use dashmap::DashMap;
use poise::serenity_prelude::GuildId;
use sea_orm::{DatabaseConnection, EntityTrait, Set};
use sea_orm::sea_query::OnConflict;
use tracing::{error, info};

use super::guild::GuildConfig;
use super::schema::RawGuildConfig;

/// Manages cached guild configurations, fetching from DB on cache miss.
pub struct ConfigManager {
    cache: DashMap<GuildId, GuildConfig>,
}

impl ConfigManager {
    /// Creates a new empty config manager.
    pub fn new() -> Self {
        Self {
            cache: DashMap::new(),
        }
    }

    /// Retrieves a guild configuration, computing from DB if not cached.
    pub async fn get_guild_config(
        &self,
        db: &DatabaseConnection,
        guild_id: GuildId,
    ) -> GuildConfig {
        if let Some(config) = self.cache.get(&guild_id) {
            return config.clone();
        }

        let config = self.compute(db, guild_id).await;
        self.cache.insert(guild_id, config.clone());
        config
    }

    /// Reloads a guild's configuration from the database.
    pub async fn reload(&self, db: &DatabaseConnection, guild_id: GuildId) {
        if !self.cache.contains_key(&guild_id) {
            return;
        }

        let config = self.compute(db, guild_id).await;
        self.cache.insert(guild_id, config);
        info!("Reloaded config for guild {guild_id}");
    }

    /// Invalidates and removes a guild's cached config.
    pub fn invalidate(&self, guild_id: &GuildId) {
        self.cache.remove(guild_id);
    }

    /// Computes a guild configuration by fetching from DB or creating a default.
    async fn compute(&self, db: &DatabaseConnection, guild_id: GuildId) -> GuildConfig {
        let guild_id_str = guild_id.to_string();

        // Try to fetch existing config.
        match crate::lib::entities::guild::Entity::find_by_id(guild_id_str.clone())
            .one(db)
            .await
        {
            Ok(Some(row)) => {
                match serde_json::from_value::<RawGuildConfig>(row.config) {
                    Ok(config) => return GuildConfig::new(guild_id, config),
                    Err(e) => {
                        error!("Failed to parse config for guild {guild_id}: {e}");
                    }
                }
            }
            Ok(None) => {
                // Guild doesn't exist in DB, insert with default config.
                let default_config = RawGuildConfig::default();
                let config_json = serde_json::to_value(&default_config).unwrap_or_default();

                let model = crate::lib::entities::guild::ActiveModel {
                    id: Set(guild_id_str.into()),
                    config: Set(config_json),
                };

                let _ = crate::lib::entities::guild::Entity::insert(model)
                    .on_conflict(
                        OnConflict::column(crate::lib::entities::guild::Column::Id)
                            .do_nothing()
                            .to_owned(),
                    )
                    .exec(db)
                    .await;

                return GuildConfig::new(guild_id, default_config);
            }
            Err(e) => {
                error!("Database error fetching config for guild {guild_id}: {e}");
            }
        }

        // Fallback to default.
        GuildConfig::new(guild_id, RawGuildConfig::default())
    }
}
