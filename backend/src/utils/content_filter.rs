use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

use crate::config::schema::{ContentFilterConfig, DetectorMode};
use crate::content_filter::types::ContentFilterStatus;
use crate::database::messages::SerializedMessage;
use crate::entities::{content_filter_alert, content_filter_log};
use crate::utils::constants::cf;

/// Computes the risk score for a message based on its properties.
pub fn compute_message_risk(config: &ContentFilterConfig, message: &SerializedMessage) -> f64 {
    let risk_increase = match config.detector_mode {
        DetectorMode::Lenient => cf::HEURISTIC_LENIENT_RISK_INCREASE,
        DetectorMode::Medium => cf::HEURISTIC_MEDIUM_RISK_INCREASE,
        DetectorMode::Strict => cf::HEURISTIC_STRICT_RISK_INCREASE,
    };

    let mut risk = cf::HEURISTIC_BASE_RISK;

    if !message.attachments.is_empty() {
        risk += risk_increase;
    }
    if message.reference_id.is_some() {
        risk += risk_increase;
    }

    risk.min(1.0)
}

/// Fetches recent alerts and computes false-positive ratio + highest score.
pub async fn get_recent_alerts_and_false_positive_ratio(
    db: &sea_orm::DatabaseConnection,
    guild_id: &str,
    channel_id: &str,
    since: chrono::DateTime<chrono::Utc>,
) -> Result<(Vec<content_filter_alert::Model>, f64, f64), sea_orm::DbErr> {
    let alerts = content_filter_alert::Entity::find()
        .filter(content_filter_alert::Column::GuildId.eq(guild_id))
        .filter(content_filter_alert::Column::ChannelId.eq(channel_id))
        .filter(content_filter_alert::Column::CreatedAt.gt(since.naive_utc()))
        .all(db)
        .await?;

    let total = alerts.len();
    let false_count = alerts
        .iter()
        .filter(|a| a.mod_status == ContentFilterStatus::False)
        .count();
    let ratio = if total > 0 {
        false_count as f64 / total as f64
    } else {
        0.0
    };

    let highest_score = alerts
        .iter()
        .map(|a| a.highest_score)
        .fold(0.0, f64::max);

    Ok((alerts, ratio, highest_score))
}

/// Checks if an alert already exists for a message ID.
pub async fn alert_exists_for_message(
    db: &sea_orm::DatabaseConnection,
    message_id: &str,
) -> Result<bool, sea_orm::DbErr> {
    let existing = content_filter_alert::Entity::find()
        .filter(content_filter_alert::Column::MessageId.eq(message_id))
        .one(db)
        .await?;

    Ok(existing.is_some())
}

/// Delete old content-filter alerts.
#[allow(dead_code)]
pub async fn delete_old_alerts(
    db: &sea_orm::DatabaseConnection,
    ttl_ms: u64,
) -> Result<u64, sea_orm::DbErr> {
    let threshold_ms = chrono::Utc::now().timestamp_millis() - ttl_ms as i64;
    let threshold = chrono::DateTime::from_timestamp_millis(threshold_ms)
        .unwrap_or_else(chrono::Utc::now);

    let result = content_filter_alert::Entity::delete_many()
        .filter(content_filter_alert::Column::CreatedAt.lt(threshold.naive_utc()))
        .exec(db)
        .await?;

    Ok(result.rows_affected)
}

/// Delete old content-filter detector logs.
#[allow(dead_code)]
pub async fn delete_old_content_logs(
    db: &sea_orm::DatabaseConnection,
    ttl_ms: u64,
) -> Result<u64, sea_orm::DbErr> {
    let threshold_ms = chrono::Utc::now().timestamp_millis() - ttl_ms as i64;
    let threshold = chrono::DateTime::from_timestamp_millis(threshold_ms)
        .unwrap_or_else(chrono::Utc::now);

    let result = content_filter_log::Entity::delete_many()
        .filter(content_filter_log::Column::CreatedAt.lt(threshold.naive_utc()))
        .exec(db)
        .await?;

    Ok(result.rows_affected)
}

/// Handle alert moderation status transitions.
pub fn handle_alert_mod_status(
    original: ContentFilterStatus,
    target: ContentFilterStatus,
) -> ContentFilterStatus {
    if target == ContentFilterStatus::Resolved {
        match original {
            ContentFilterStatus::Pending | ContentFilterStatus::False => ContentFilterStatus::Resolved,
            _ => ContentFilterStatus::Pending,
        }
    } else if target == ContentFilterStatus::False {
        match original {
            ContentFilterStatus::Pending | ContentFilterStatus::Resolved => ContentFilterStatus::False,
            _ => ContentFilterStatus::Pending,
        }
    } else {
        original
    }
}

/// Update an alert's mod_status in the database.
pub async fn update_alert_mod_status(
    db: &sea_orm::DatabaseConnection,
    alert_id: &str,
    new_status: ContentFilterStatus,
) -> Result<Option<content_filter_alert::Model>, sea_orm::DbErr> {
    use sea_orm::{ActiveModelTrait, Set};

    if let Some(model) = content_filter_alert::Entity::find_by_id(alert_id)
        .one(db)
        .await? {
        let mut active: content_filter_alert::ActiveModel = model.into();
        active.mod_status = Set(new_status);
        let updated = active.update(db).await?;
        return Ok(Some(updated));
    }

    Ok(None)
}

/// Update an alert's del_status in the database.
pub async fn update_alert_del_status(
    db: &sea_orm::DatabaseConnection,
    alert_id: &str,
    new_status: ContentFilterStatus,
) -> Result<Option<content_filter_alert::Model>, sea_orm::DbErr> {
    use sea_orm::{ActiveModelTrait, Set};

    if let Some(model) = content_filter_alert::Entity::find_by_id(alert_id)
        .one(db)
        .await? {
        let mut active: content_filter_alert::ActiveModel = model.into();
        active.del_status = Set(new_status);
        let updated = active.update(db).await?;
        return Ok(Some(updated));
    }

    Ok(None)
}

/// Get an alert by flagged message ID.
pub async fn get_alert_by_message_id(
    db: &sea_orm::DatabaseConnection,
    message_id: &str,
) -> Result<Option<content_filter_alert::Model>, sea_orm::DbErr> {
    content_filter_alert::Entity::find()
        .filter(content_filter_alert::Column::MessageId.eq(message_id))
        .one(db)
        .await
}

/// Get detector content log by alert ID.
pub async fn get_content_log_by_alert_id(
    db: &sea_orm::DatabaseConnection,
    alert_id: &str,
) -> Result<Option<String>, sea_orm::DbErr> {
    let log = content_filter_log::Entity::find()
        .filter(content_filter_log::Column::AlertId.eq(alert_id))
        .one(db)
        .await?;

    Ok(log.map(|row| row.content))
}

