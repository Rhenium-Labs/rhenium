//! Scan job priority queue.

use std::collections::{BinaryHeap, HashMap};
use std::sync::{Mutex, MutexGuard};

use super::types::{QueueDiagnostics, ScanJob};

const MAX_ACTIVE_JOBS: usize = 12_000;
const MAX_JOB_AGE_MS: u64 = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS: u64 = 60 * 1000;
const COMPACT_RATIO: f64 = 2.25;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum QueueType {
    New,
    Retry,
}

struct QueueState {
    new_heap: BinaryHeap<ScanJob>,
    retry_heap: BinaryHeap<ScanJob>,
    new_jobs: HashMap<String, ScanJob>,
    retry_jobs: HashMap<String, ScanJob>,
    key_queue: HashMap<String, QueueType>,
    guild_depth: HashMap<String, usize>,
    last_cleanup_at: u64,
    retry_turn: bool,
}

impl QueueState {
    fn new() -> Self {
        Self {
            new_heap: BinaryHeap::new(),
            retry_heap: BinaryHeap::new(),
            new_jobs: HashMap::new(),
            retry_jobs: HashMap::new(),
            key_queue: HashMap::new(),
            guild_depth: HashMap::new(),
            last_cleanup_at: 0,
            retry_turn: false,
        }
    }
}

static QUEUE: Mutex<Option<QueueState>> = Mutex::new(None);

fn recover_queue_lock() -> MutexGuard<'static, Option<QueueState>> {
    QUEUE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn with_queue<F, R>(f: F) -> R
where
    F: FnOnce(&mut QueueState) -> R,
{
    let mut guard = recover_queue_lock();
    let state = guard.get_or_insert_with(QueueState::new);
    f(state)
}

/// Adds a job to the queue, deduplicating by dedupe_key.
pub fn enqueue(job: ScanJob) -> bool {
    with_queue(|q| {
        let dedupe_key = job.dedupe_key.clone();
        let target_queue = if job.is_retry { QueueType::Retry } else { QueueType::New };

        let existing_queue = q.key_queue.get(&dedupe_key).copied();
        let has_existing_entry = existing_queue
            .and_then(|queue| map_for(q, queue).get(&dedupe_key))
            .is_some();

        if let Some(existing_queue) = existing_queue {
            let existing_map = map_for(q, existing_queue);
            if let Some(existing) = existing_map.get(&dedupe_key) {
                let should_keep_existing = existing.next_run_at <= job.next_run_at
                    && existing.attempts >= job.attempts
                    && existing.risk >= job.risk;

                if should_keep_existing {
                    return false;
                }
            }

            let existing_map = map_for_mut(q, existing_queue);
            existing_map.remove(&dedupe_key);
            q.key_queue.remove(&dedupe_key);
        }

        let guild_id = job.guild_id.clone();

        let target_map = map_for_mut(q, target_queue);
        target_map.insert(dedupe_key.clone(), job.clone());
        heap_for_mut(q, target_queue).push(job);
        q.key_queue.insert(dedupe_key, target_queue);

        if !has_existing_entry {
            increment_guild_depth(q, &guild_id);
        }

        trim_if_needed(q);
        compact_if_needed(q);

        true
    })
}

/// Pulls due jobs while balancing new and retry queues.
pub fn pull_due(now: u64, max_jobs: usize) -> Vec<ScanJob> {
    with_queue(|q| {
        cleanup_stale(q, now);

        let mut jobs = Vec::new();
        while jobs.len() < max_jobs {
            let has_due_new = peek_due(q, QueueType::New, now).is_some();
            let has_due_retry = peek_due(q, QueueType::Retry, now).is_some();

            if !has_due_new && !has_due_retry {
                break;
            }

            let preferred = if has_due_new && has_due_retry {
                let pick_retry = q.retry_turn;
                q.retry_turn = !q.retry_turn;
                if pick_retry { QueueType::Retry } else { QueueType::New }
            } else if has_due_new {
                QueueType::New
            } else {
                QueueType::Retry
            };

            let popped = pop_due(q, preferred, now).or_else(|| pop_due(q, other_queue(preferred), now));
            if let Some(job) = popped {
                jobs.push(job);
            } else {
                break;
            }
        }

        jobs
    })
}

/// Returns the total queue size.
pub fn size() -> usize {
    with_queue(|q| q.new_jobs.len() + q.retry_jobs.len())
}

/// Returns the queue depth for a specific channel.
pub fn queue_depth_for_channel(channel_id: &str) -> usize {
    with_queue(|q| {
        let mut total = 0usize;
        for job in q.new_jobs.values() {
            if job.channel_id == channel_id {
                total += 1;
            }
        }
        for job in q.retry_jobs.values() {
            if job.channel_id == channel_id {
                total += 1;
            }
        }
        total
    })
}

/// Returns the queue depth for a specific guild.
pub fn queue_depth_for_guild(guild_id: &str) -> usize {
    with_queue(|q| *q.guild_depth.get(guild_id).unwrap_or(&0))
}

/// Returns whether any forced job is currently due.
pub fn has_due_forced_job(now: u64) -> bool {
    with_queue(|q| {
        q.new_jobs.values().any(|job| job.force && job.next_run_at <= now)
            || q.retry_jobs.values().any(|job| job.force && job.next_run_at <= now)
    })
}

/// Returns queue diagnostics.
pub fn diagnostics() -> QueueDiagnostics {
    with_queue(|q| {
        let jobs = q
            .new_jobs
            .values()
            .chain(q.retry_jobs.values())
            .collect::<Vec<_>>();

        let oldest_enqueued_at = jobs.iter().map(|j| j.enqueued_at).min();
        let next_scheduled_at = jobs.iter().map(|j| j.next_run_at).min();

        QueueDiagnostics {
            total: jobs.len(),
            new_jobs: q.new_jobs.len(),
            retry_jobs: q.retry_jobs.len(),
            oldest_enqueued_at,
            next_scheduled_at,
        }
    })
}

fn map_for(q: &QueueState, queue: QueueType) -> &HashMap<String, ScanJob> {
    match queue {
        QueueType::New => &q.new_jobs,
        QueueType::Retry => &q.retry_jobs,
    }
}

fn map_for_mut(q: &mut QueueState, queue: QueueType) -> &mut HashMap<String, ScanJob> {
    match queue {
        QueueType::New => &mut q.new_jobs,
        QueueType::Retry => &mut q.retry_jobs,
    }
}

fn heap_for_mut(q: &mut QueueState, queue: QueueType) -> &mut BinaryHeap<ScanJob> {
    match queue {
        QueueType::New => &mut q.new_heap,
        QueueType::Retry => &mut q.retry_heap,
    }
}

fn other_queue(queue: QueueType) -> QueueType {
    match queue {
        QueueType::New => QueueType::Retry,
        QueueType::Retry => QueueType::New,
    }
}

fn peek_due(q: &mut QueueState, queue: QueueType, now: u64) -> Option<ScanJob> {
    loop {
        let top = {
            let heap = heap_for_mut(q, queue);
            heap.peek().cloned()?
        };

        let current = map_for(q, queue).get(&top.dedupe_key);
        if !matches!(current, Some(current) if current.job_id == top.job_id) {
            let heap = heap_for_mut(q, queue);
            heap.pop();
            continue;
        }

        if top.next_run_at > now {
            return None;
        }

        return Some(top);
    }
}

fn pop_due(q: &mut QueueState, queue: QueueType, now: u64) -> Option<ScanJob> {
    loop {
        let top = {
            let heap = heap_for_mut(q, queue);
            heap.peek().cloned()?
        };
        if top.next_run_at > now {
            return None;
        }

        let popped = {
            let heap = heap_for_mut(q, queue);
            heap.pop()?
        };

        let map = map_for_mut(q, queue);
        let current = map.get(&popped.dedupe_key);
        if !matches!(current, Some(current) if current.job_id == popped.job_id) {
            continue;
        }

        map.remove(&popped.dedupe_key);
        q.key_queue.remove(&popped.dedupe_key);
        decrement_guild_depth(q, &popped.guild_id);
        return Some(popped);
    }
}

fn trim_if_needed(q: &mut QueueState) {
    while q.new_jobs.len() + q.retry_jobs.len() > MAX_ACTIVE_JOBS {
        let queue = if q.retry_jobs.len() > q.new_jobs.len() {
            QueueType::Retry
        } else {
            QueueType::New
        };
        evict_worst(q, queue);
    }
}

fn evict_worst(q: &mut QueueState, queue: QueueType) {
    let map = map_for_mut(q, queue);
    if map.is_empty() {
        return;
    }

    let mut worst: Option<ScanJob> = None;
    for job in map.values() {
        let is_worse = match &worst {
            None => true,
            Some(w) => job.next_run_at > w.next_run_at
                || (job.next_run_at == w.next_run_at && job.risk < w.risk),
        };
        if is_worse {
            worst = Some(job.clone());
        }
    }

    if let Some(worst) = worst {
        map.remove(&worst.dedupe_key);
        q.key_queue.remove(&worst.dedupe_key);
        decrement_guild_depth(q, &worst.guild_id);
    }
}

fn compact_if_needed(q: &mut QueueState) {
    if (q.new_heap.len() as f64) > q.new_jobs.len() as f64 * COMPACT_RATIO + 64.0 {
        q.new_heap = BinaryHeap::from(q.new_jobs.values().cloned().collect::<Vec<_>>());
    }
    if (q.retry_heap.len() as f64) > q.retry_jobs.len() as f64 * COMPACT_RATIO + 64.0 {
        q.retry_heap = BinaryHeap::from(q.retry_jobs.values().cloned().collect::<Vec<_>>());
    }
}

fn cleanup_stale(q: &mut QueueState, now: u64) {
    if now.saturating_sub(q.last_cleanup_at) < CLEANUP_INTERVAL_MS {
        return;
    }

    q.last_cleanup_at = now;
    let cutoff = now.saturating_sub(MAX_JOB_AGE_MS);

    let stale_keys_new: Vec<String> = q
        .new_jobs
        .iter()
        .filter(|(_, job)| job.enqueued_at < cutoff)
        .map(|(k, _)| k.clone())
        .collect();
    for key in stale_keys_new {
        if let Some(job) = q.new_jobs.remove(&key) {
            q.key_queue.remove(&key);
            decrement_guild_depth(q, &job.guild_id);
        }
    }

    let stale_keys_retry: Vec<String> = q
        .retry_jobs
        .iter()
        .filter(|(_, job)| job.enqueued_at < cutoff)
        .map(|(k, _)| k.clone())
        .collect();
    for key in stale_keys_retry {
        if let Some(job) = q.retry_jobs.remove(&key) {
            q.key_queue.remove(&key);
            decrement_guild_depth(q, &job.guild_id);
        }
    }

    compact_if_needed(q);
}

fn increment_guild_depth(q: &mut QueueState, guild_id: &str) {
    let entry = q.guild_depth.entry(guild_id.to_string()).or_insert(0);
    *entry += 1;
}

fn decrement_guild_depth(q: &mut QueueState, guild_id: &str) {
    if let Some(depth) = q.guild_depth.get_mut(guild_id) {
        *depth = depth.saturating_sub(1);
        if *depth == 0 {
            q.guild_depth.remove(guild_id);
        }
    }
}
