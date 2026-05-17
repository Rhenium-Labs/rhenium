//! Dead letter store for failed content filter scan jobs.

use std::sync::{Mutex, MutexGuard};
use tracing::error;

use super::types::{DeadLetterEntry, DeadLetterJob, ScanJob};

const DEAD_LETTER_PREFIX: &str = "cf:dlq";
const MAX_RECENT_ENTRIES: usize = 200;

static RECENT: Mutex<Vec<DeadLetterEntry>> = Mutex::new(Vec::new());
static TOTAL_RECORDED: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

fn recent_entries() -> MutexGuard<'static, Vec<DeadLetterEntry>> {
    RECENT.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Records a permanently failed scan job in memory and KV storage.
pub async fn record(kv: &crate::kv::KvStore, job: &ScanJob, reason: &str, err: Option<&str>) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let entry = DeadLetterEntry {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: now,
        reason: reason.to_string(),
        job: DeadLetterJob {
            job_id: job.job_id.clone(),
            message_id: job.message_id.clone(),
            source: job.source.to_string(),
            guild_id: job.guild_id.clone(),
            channel_id: job.channel_id.clone(),
            author_id: job.author_id.clone(),
            attempts: job.attempts,
            max_attempts: job.max_attempts,
            risk: job.risk,
        },
        error: err.map(|e| e.chars().take(4000).collect()),
    };

    TOTAL_RECORDED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let mut recent = recent_entries();
    recent.insert(0, entry.clone());
    if recent.len() > MAX_RECENT_ENTRIES {
        recent.truncate(MAX_RECENT_ENTRIES);
    }

    let kv_key = format!("{DEAD_LETTER_PREFIX}:{}:{}", entry.created_at, entry.id);
    if let Err(e) = kv.put(&kv_key, &entry) {
        error!("CF dead-letter KV persistence failed: {e}");
    }

    error!(
        reason = reason,
        job_id = %job.job_id,
        source = %job.source,
        guild_id = %job.guild_id,
        channel_id = %job.channel_id,
        message_id = %job.message_id,
        attempts = job.attempts,
        max_attempts = job.max_attempts,
        "CF job moved to dead-letter queue"
    );
}

/// Returns the most recent dead-letter entries.
pub fn get_recent(limit: usize) -> Vec<DeadLetterEntry> {
    recent_entries().iter().take(limit.max(1)).cloned().collect()
}

/// Returns aggregate dead-letter counters.
pub fn get_summary() -> (usize, usize) {
    let total = TOTAL_RECORDED.load(std::sync::atomic::Ordering::Relaxed);
    let buffered = recent_entries().len();
    (total, buffered)
}
