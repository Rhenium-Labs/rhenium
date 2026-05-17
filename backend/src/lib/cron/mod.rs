//! Background cron jobs for Rhenium.
//!
//! - Message buffer flush (periodic)
//! - Message TTL cleanup (delete old messages from DB)
//! - Report auto-disregard (close stale pending reports)
//! - Content filter alert cleanup
//! - Channel state pruning

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use sea_orm::sea_query::Expr;
use tokio_cron_scheduler::{Job, JobScheduler};
use tracing::{error, info};

/// Starts all background cron tasks.
pub fn start(data: crate::Data, ctx: poise::serenity_prelude::Context) {
    let data1 = data.clone();
    let data2 = data.clone();
    let data3 = data.clone();
    let resolved_by = ctx.cache.current_user().id;
    let insert_cron = normalize_cron_expression(&data.global_config.database.messages.insert_cron);
    let delete_cron = normalize_cron_expression(&data.global_config.database.messages.delete_cron);
    let disregard_cron = normalize_cron_expression(&data.global_config.database.reports.disregard_cron);

    tokio::spawn(async move {
        let scheduler = match JobScheduler::new().await {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to initialize cron scheduler: {e}");
                return;
            }
        };

        let insert_data = data1.clone();
        let insert_job = Job::new_async(insert_cron.as_str(), move |_uuid, _l| {
            let insert_data = insert_data.clone();
            Box::pin(async move {
                flush_messages(&insert_data).await;
            })
        });
        match insert_job {
            Ok(job) => {
                if let Err(e) = scheduler.add(job).await {
                    error!("Failed to add MESSAGE_INSERT_CRON job: {e}");
                }
            }
            Err(e) => error!("Failed to build MESSAGE_INSERT_CRON job: {e}"),
        }

        let delete_data = data2.clone();
        let delete_job = Job::new_async(delete_cron.as_str(), move |_uuid, _l| {
            let delete_data = delete_data.clone();
            Box::pin(async move {
                cleanup_old_messages(&delete_data).await;
            })
        });
        match delete_job {
            Ok(job) => {
                if let Err(e) = scheduler.add(job).await {
                    error!("Failed to add MESSAGE_DELETE_CRON job: {e}");
                }
            }
            Err(e) => error!("Failed to build MESSAGE_DELETE_CRON job: {e}"),
        }

        let report_data = data3.clone();
        let report_job = Job::new_async(disregard_cron.as_str(), move |_uuid, _l| {
            let report_data = report_data.clone();
            Box::pin(async move {
                auto_disregard_reports(&report_data, resolved_by).await;
            })
        });
        match report_job {
            Ok(job) => {
                if let Err(e) = scheduler.add(job).await {
                    error!("Failed to add MESSAGE_REPORT_DISREGARD_CRON job: {e}");
                }
            }
            Err(e) => error!("Failed to build MESSAGE_REPORT_DISREGARD_CRON job: {e}"),
        }

        if let Err(e) = scheduler.start().await {
            error!("Failed to start cron scheduler: {e}");
            return;
        }

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
        }
    });

    info!("Cron jobs started.");
}

/// Converts TS-style cron expressions (5 fields) to scheduler-compatible expressions.
///
/// The TS bot stores cron expressions such as `"0 * * * *"` (minute precision).
/// `tokio-cron-scheduler` expects seconds precision, so prepend `0` when needed.
fn normalize_cron_expression(raw: &str) -> String {
    let expr = raw.trim();
    let fields = expr.split_whitespace().count();
    match fields {
        5 => format!("0 {expr}"),
        _ => expr.to_string(),
    }
}

/// Flushes the message buffer to the database.
async fn flush_messages(data: &crate::Data) {
    data.message_manager.insert(&data.db, None).await;
}

/// Deletes old messages from the database based on TTL config.
async fn cleanup_old_messages(data: &crate::Data) {
    let ttl_ms = data.global_config.database.messages.ttl;
    if ttl_ms == 0 {
        return;
    }

    let threshold_ms = chrono::Utc::now().timestamp_millis() - ttl_ms as i64;
    let threshold = chrono::DateTime::from_timestamp_millis(threshold_ms)
        .unwrap_or(chrono::Utc::now());

    match crate::lib::entities::message::Entity::delete_many()
        .filter(crate::lib::entities::message::Column::CreatedAt.lte(threshold.naive_utc()))
        .exec(&data.db)
        .await
    {
        Ok(result) => {
            if result.rows_affected > 0 {
                info!("Cleaned up {} old messages.", result.rows_affected);
            }
        }
        Err(e) => error!("Failed to clean up old messages: {e}"),
    }
}

/// Automatically disregards stale pending message reports.
/// For each guild, reads auto_disregard_after from the JSON config and applies it.
async fn auto_disregard_reports(
    data: &crate::Data,
    resolved_by: poise::serenity_prelude::UserId,
) {
    use crate::lib::entities::message_report::{Column as MRCol, Entity as MREntity, ReportStatus};

    // Fetch all pending reports, deduplicate guild IDs in memory.
    let pending = match MREntity::find()
        .filter(MRCol::Status.eq(ReportStatus::Pending))
        .all(&data.db)
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            error!("Failed to fetch guilds for auto-disregard: {e}");
            return;
        }
    };

    let guild_ids: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        pending.iter()
            .filter(|r| seen.insert(r.guild_id.clone()))
            .map(|r| r.guild_id.clone())
            .collect()
    };

    let now = chrono::Utc::now();
    let now_ms = now.timestamp_millis();

    for guild_id in guild_ids {
        let guild_id: String = guild_id;

        let guild_id_parsed = match guild_id.parse::<u64>() {
            Ok(id) => poise::serenity_prelude::GuildId::new(id),
            Err(_) => continue,
        };

        let config = data.config_manager.get_guild_config(&data.db, guild_id_parsed).await;
        let reports_config = match config.parse_reports_config() {
            Some(c) => c,
            None => continue,
        };

        let auto_disregard_ms = reports_config
            .auto_disregard_after
            .trim()
            .parse::<u64>()
            .unwrap_or(0);

        if auto_disregard_ms == 0 {
            continue;
        }

        let threshold_ms = now_ms - auto_disregard_ms as i64;
        let threshold = match chrono::DateTime::from_timestamp_millis(threshold_ms) {
            Some(t) => t,
            None => continue,
        };

        match MREntity::update_many()
            .col_expr(MRCol::Status, Expr::value(ReportStatus::Disregarded))
            .col_expr(MRCol::ResolvedAt, Expr::value(now.naive_utc()))
            .col_expr(MRCol::ResolvedBy, Expr::value(resolved_by.to_string()))
            .filter(MRCol::GuildId.eq(guild_id.clone()))
            .filter(MRCol::Status.eq(ReportStatus::Pending))
            .filter(MRCol::ReportedAt.lte(threshold.naive_utc()))
            .exec(&data.db)
            .await
        {
            Ok(result) if result.rows_affected > 0 => {
                info!("Auto-disregarded {} reports.", result.rows_affected);
            }
            Err(e) => error!("Failed to auto-disregard reports: {e}"),
            _ => {}
        }
    }
}
