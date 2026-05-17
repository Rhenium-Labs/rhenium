use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{DateTime, Utc};
use poise::serenity_prelude as serenity;
use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Statement, TryGetable, Value};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::utils::constants::EMPTY_MESSAGE_CONTENT;

/// A serialized message suitable for database storage.
#[derive(Debug, Clone)]
pub struct SerializedMessage {
    pub id: String,
    pub guild_id: String,
    pub author_id: String,
    pub channel_id: String,
    pub sticker_id: Option<String>,
    pub reference_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub content: Option<String>,
    pub attachments: Vec<String>,
    pub deleted: bool,
}

/// Manages message caching and database insertion.
///
/// Messages are buffered in memory and periodically flushed to the database
/// via cron jobs or on process exit. This reduces DB write pressure significantly.
pub struct MessageManager {
    /// In-memory message buffer.
    cache: RwLock<HashMap<String, SerializedMessage>>,
    /// Message IDs currently excluded from external processing (e.g., during purges).
    exclusions: RwLock<HashSet<String>>,
    /// Mutex to prevent concurrent insertion operations.
    is_inserting: AtomicBool,
}

impl MessageManager {
    /// Creates a new empty message manager.
    pub fn new() -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            exclusions: RwLock::new(HashSet::new()),
            is_inserting: AtomicBool::new(false),
        }
    }

    /// Returns the number of cached messages.
    pub async fn size(&self) -> usize {
        self.cache.read().await.len()
    }

    /// Adds message IDs to the exclusion set.
    pub async fn add_exclusions(&self, ids: &[String]) {
        let mut exclusions = self.exclusions.write().await;
        for id in ids {
            exclusions.insert(id.clone());
        }
    }

    /// Removes message IDs from the exclusion set.
    pub async fn remove_exclusions(&self, ids: &[String]) {
        let mut exclusions = self.exclusions.write().await;
        for id in ids {
            exclusions.remove(id);
        }
    }

    /// Returns true if a message ID is currently excluded.
    pub async fn has_exclusion(&self, id: &str) -> bool {
        self.exclusions.read().await.contains(id)
    }

    /// Returns true if any of the provided message IDs are currently excluded.
    pub async fn has_any_exclusion(&self, ids: &[String]) -> bool {
        let exclusions = self.exclusions.read().await;
        ids.iter().any(|id| exclusions.contains(id))
    }

    /// Serializes a Discord message into a format suitable for database storage.
    pub fn serialize(message: &serenity::Message, cache: &serenity::Cache) -> SerializedMessage {
        let sticker_id = message.sticker_items.first().map(|s| s.id.to_string());
        let reference_id = message
            .message_reference
            .as_ref()
            .and_then(|r| r.message_id.map(|id| id.to_string()));
        // TS uses `message.content ?? EMPTY_MESSAGE_CONTENT`; Discord message content is a
        // string, so empty content remains empty rather than becoming the placeholder.
        let raw = message.content.clone();
        let content = Some(crate::utils::messages::clean_content(
            &raw,
            cache,
            message.guild_id,
            &message.mentions,
        ));

        SerializedMessage {
            id: message.id.to_string(),
            guild_id: message
                .guild_id
                .map(|id| id.to_string())
                .unwrap_or_default(),
            author_id: message.author.id.to_string(),
            channel_id: message.channel_id.to_string(),
            sticker_id,
            reference_id,
            created_at: *message.timestamp,
            content,
            attachments: message
                .attachments
                .iter()
                .map(|a| a.url.clone())
                .collect(),
            deleted: false,
        }
    }

    /// Queues a message for database insertion.
    /// If the cache exceeds 5000 messages, an immediate insertion is triggered.
    pub async fn queue(
        &self,
        message: &serenity::Message,
        db: &DatabaseConnection,
        cache: &serenity::Cache,
    ) {
        let serialized = Self::serialize(message, cache);

        {
            let cache = self.cache.read().await;
            if cache.len() + 1 >= 5000 {
                warn!("Message cache has reached 5000 entries. Early insertion triggered.");
                drop(cache);
                self.insert(db, None).await;
            }
        }

        let mut cache = self.cache.write().await;
        cache.insert(serialized.id.clone(), serialized);
    }

    /// Retrieves a message from cache by ID.
    pub async fn get_cached(&self, id: &str) -> Option<SerializedMessage> {
        self.cache.read().await.get(id).cloned()
    }

    /// Converts a Message entity model to a SerializedMessage.
    fn from_model(model: crate::entities::message::Model) -> SerializedMessage {
        SerializedMessage {
            id: model.id,
            guild_id: model.guild_id,
            author_id: model.author_id,
            channel_id: model.channel_id,
            sticker_id: model.sticker_id,
            reference_id: model.reference_id,
            created_at: model.created_at.and_utc(),
            content: model.content,
            attachments: model.attachments,
            deleted: model.deleted,
        }
    }

    /// Retrieves a message from cache or database by ID.
    pub async fn get(&self, db: &DatabaseConnection, id: &str) -> Option<SerializedMessage> {
        if let Some(msg) = self.cache.read().await.get(id).cloned() {
            return Some(msg);
        }

        let model = crate::entities::message::Entity::find_by_id(id)
            .one(db)
            .await
            .map_err(|err| warn!(message_id = id, "Failed to fetch message from database: {err}"))
            .ok()??;
        Some(Self::from_model(model))
    }

    /// Retrieves multiple messages by IDs from cache and database.
    pub async fn get_many(
        &self,
        db: &DatabaseConnection,
        ids: &[String],
    ) -> Vec<SerializedMessage> {
        let mut cached = Vec::new();
        let mut missing = Vec::new();
        {
            let cache = self.cache.read().await;
            for id in ids {
                if let Some(msg) = cache.get(id) {
                    cached.push(msg.clone());
                } else {
                    missing.push(id.clone());
                }
            }
        }

        if missing.is_empty() {
            return cached;
        }

        let mut out = cached;
        match crate::entities::message::Entity::find()
            .filter(crate::entities::message::Column::Id.is_in(missing))
            .all(db)
            .await
        {
            Ok(rows) => out.extend(rows.into_iter().map(Self::from_model)),
            Err(err) => warn!("Failed to fetch messages from database: {err}"),
        }
        out
    }

    /// Marks a message as deleted in cache or database.
    pub async fn delete(&self, db: &DatabaseConnection, id: &str) -> Option<SerializedMessage> {
        {
            let mut cache = self.cache.write().await;
            if let Some(msg) = cache.get_mut(id) {
                msg.deleted = true;
                return Some(msg.clone());
            }
        }

        let stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"UPDATE "Message" SET deleted = true
               WHERE id = $1
               RETURNING id, guild_id, author_id, channel_id, sticker_id, reference_id, created_at, content, attachments, deleted"#,
            [id.to_string().into()],
        );

        let row = match db.query_one(stmt).await {
            Ok(row) => row,
            Err(err) => {
                warn!(message_id = id, "Failed to mark message deleted in database: {err}");
                None
            }
        }?;
        Self::deserialize_row(&row)
    }

    /// Marks multiple messages as deleted in cache and database.
    pub async fn bulk_delete(
        &self,
        db: &DatabaseConnection,
        ids: &[String],
    ) -> Vec<SerializedMessage> {
        let mut deleted = Vec::new();
        let mut cached_count = 0usize;

        {
            let mut cache = self.cache.write().await;
            for id in ids {
                if let Some(msg) = cache.get_mut(id) {
                    if !msg.deleted {
                        msg.deleted = true;
                        deleted.push(msg.clone());
                        cached_count += 1;
                    }
                }
            }
        }

        if cached_count != ids.len() {
            let stmt = Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"UPDATE "Message"
                   SET deleted = true
                   WHERE id = ANY($1)
                   RETURNING id, guild_id, author_id, channel_id, sticker_id, reference_id, created_at, content, attachments, deleted"#,
                [ids.to_vec().into()],
            );
            match db.query_all(stmt).await {
                Ok(rows) => deleted.extend(rows.iter().filter_map(Self::deserialize_row)),
                Err(err) => warn!("Failed to mark messages deleted in database: {err}"),
            }
        }

        // Preserve caller-provided order as much as possible.
        let id_set: HashSet<&String> = ids.iter().collect();
        deleted.sort_by_key(|msg| {
            ids.iter()
                .position(|id| id == &msg.id)
                .unwrap_or(id_set.len())
        });
        deleted
    }

    /// Returns messages for a channel from cache, merged with DB results.
    /// Used by the heuristic scanner.
    pub async fn get_for_channel(
        &self,
        db: &DatabaseConnection,
        channel_id: &str,
        limit: usize,
    ) -> Vec<SerializedMessage> {
        let cache = self.cache.read().await;
        let cached: Vec<SerializedMessage> = cache
            .values()
            .filter(|m| m.channel_id == channel_id && !m.deleted)
            .cloned()
            .collect();

        let mut map: HashMap<String, SerializedMessage> = HashMap::new();
        match crate::entities::message::Entity::find()
            .filter(crate::entities::message::Column::ChannelId.eq(channel_id))
            .filter(crate::entities::message::Column::Deleted.eq(false))
            .order_by_desc(crate::entities::message::Column::CreatedAt)
            .limit(limit as u64)
            .all(db)
            .await
        {
            Ok(rows) => {
                for model in rows {
                    let msg = Self::from_model(model);
                    map.insert(msg.id.clone(), msg);
                }
            }
            Err(err) => warn!(channel_id, "Failed to fetch channel messages from database: {err}"),
        }

        for msg in cached {
            map.insert(msg.id.clone(), msg);
        }

        let mut merged: Vec<SerializedMessage> = map.into_values().collect();
        merged.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        merged.truncate(limit);
        merged
    }

    /// Updates the content of a message and returns the old content.
    pub async fn update_content(
        &self,
        db: &DatabaseConnection,
        id: &str,
        new_content: &str,
    ) -> String {
        {
            let mut cache = self.cache.write().await;
            if let Some(msg) = cache.get_mut(id) {
                let old = msg
                    .content
                    .clone()
                    .unwrap_or_else(|| EMPTY_MESSAGE_CONTENT.to_string());
                msg.content = Some(new_content.to_string());
                return old;
            }
        }

        let old_stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT content FROM "Message" WHERE id = $1"#,
            [id.to_string().into()],
        );
        let old = db
            .query_one(old_stmt)
            .await
            .map_err(|err| {
                warn!(message_id = id, "Failed to fetch old message content: {err}");
                err
            })
            .ok()
            .flatten()
            .and_then(|row| String::try_get_by(&row, "content").ok());

        let update_stmt = Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"UPDATE "Message" SET content = $2 WHERE id = $1"#,
            [id.to_string().into(), new_content.to_string().into()],
        );
        if let Err(err) = db.execute(update_stmt).await {
            warn!(message_id = id, "Failed to update message content in database: {err}");
        }
        old.unwrap_or_else(|| EMPTY_MESSAGE_CONTENT.to_string())
    }

    /// Finds messages matching criteria in the cache, sorted newest-first.
    pub async fn find_matching(
        &self,
        channel_id: &str,
        author_id: &str,
        limit: usize,
    ) -> Vec<String> {
        let cache = self.cache.read().await;
        let mut matching: Vec<&SerializedMessage> = cache
            .values()
            .filter(|msg| {
                msg.channel_id == channel_id && msg.author_id == author_id && !msg.deleted
            })
            .collect();

        // Sort by snowflake ID descending (newest first), matching TS BigInt behavior.
        matching.sort_by(|a, b| {
            let a_id = a.id.parse::<u64>().ok();
            let b_id = b.id.parse::<u64>().ok();
            match (a_id, b_id) {
                (Some(a_id), Some(b_id)) => b_id.cmp(&a_id),
                _ => b.id.cmp(&a.id),
            }
        });

        matching
            .into_iter()
            .take(limit)
            .map(|msg| msg.id.clone())
            .collect()
    }

    /// Inserts all cached messages into the database and clears the cache.
    pub async fn insert(&self, db: &DatabaseConnection, event: Option<&str>) {
        let cache_size = self.cache.read().await.len();
        if cache_size == 0 {
            info!("No messages to insert.");
            return;
        }

        while self.is_inserting.swap(true, Ordering::SeqCst) {
            if event.is_none() {
                warn!("Message insertion is already in progress. Skipping.");
                return;
            }
            warn!("Message insertion is already in progress. Waiting before shutdown flush.");
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        struct InsertingGuard<'a>(&'a AtomicBool);
        impl Drop for InsertingGuard<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _inserting_guard = InsertingGuard(&self.is_inserting);

        if let Some(ev) = event {
            info!("Inserting cached messages before exiting due to {ev}...");
        } else {
            info!("Inserting {cache_size} cached messages...");
        }

        let messages: Vec<SerializedMessage> = {
            let cache = self.cache.read().await;
            cache.values().cloned().collect()
        };
        let flushed_ids: HashSet<String> = messages.iter().map(|message| message.id.clone()).collect();

        let mut placeholders = Vec::with_capacity(messages.len());
        let mut values: Vec<Value> = Vec::with_capacity(messages.len() * 10);

        for (idx, m) in messages.iter().enumerate() {
            let base = idx * 10;
            placeholders.push(format!(
                "(${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}, ${})",
                base + 1,
                base + 2,
                base + 3,
                base + 4,
                base + 5,
                base + 6,
                base + 7,
                base + 8,
                base + 9,
                base + 10
            ));

            values.push(m.id.clone().into());
            values.push(m.guild_id.clone().into());
            values.push(m.author_id.clone().into());
            values.push(m.channel_id.clone().into());
            values.push(m.sticker_id.clone().into());
            values.push(m.reference_id.clone().into());
            values.push(m.created_at.into());
            values.push(m.content.clone().into());
            values.push(m.attachments.clone().into());
            values.push(m.deleted.into());
        }

        let sql = format!(
            r#"INSERT INTO "Message"
               (id, guild_id, author_id, channel_id, sticker_id, reference_id, created_at, content, attachments, deleted)
               VALUES {}
               ON CONFLICT (id) DO NOTHING
               RETURNING id"#,
            placeholders.join(", ")
        );

        let inserted = match db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                values,
            ))
            .await
        {
            Ok(rows) => rows.len() as u64,
            Err(e) => {
                error!("Failed to insert cached messages: {e}");
                return;
            }
        };

        let mut cache = self.cache.write().await;
        cache.retain(|id, _| !flushed_ids.contains(id));
        info!("Stored {inserted} messages.");
    }

    fn deserialize_row(row: &sea_orm::QueryResult) -> Option<SerializedMessage> {
        let id: String = String::try_get_by(row, "id").ok()?;
        let guild_id: String = String::try_get_by(row, "guild_id").ok()?;
        let author_id: String = String::try_get_by(row, "author_id").ok()?;
        let channel_id: String = String::try_get_by(row, "channel_id").ok()?;
        let sticker_id: Option<String> = Option::<String>::try_get_by(row, "sticker_id").ok()?;
        let reference_id: Option<String> = Option::<String>::try_get_by(row, "reference_id").ok()?;
        let created_at: DateTime<Utc> = DateTime::<Utc>::try_get_by(row, "created_at").ok()?;
        let content: Option<String> = Option::<String>::try_get_by(row, "content").ok()?;
        let attachments: Vec<String> = Vec::<String>::try_get_by(row, "attachments").ok()?;
        let deleted: bool = bool::try_get_by(row, "deleted").ok()?;

        Some(SerializedMessage {
            id,
            guild_id,
            author_id,
            channel_id,
            sticker_id,
            reference_id,
            created_at,
            content,
            attachments,
            deleted,
        })
    }
}
