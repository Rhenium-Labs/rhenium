//! Automated content filter scanner — background job processor.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Mutex, MutexGuard,
};

use std::sync::LazyLock;
use poise::serenity_prelude as serenity;
use regex::Regex;
use tracing::{error, info, warn};

use super::{dead_letter, scheduler, scanner, state};
use super::types::{ContentPredictionData, ContentPredictions, ScanJob, ScanSource};
use crate::config::guild::GuildConfig;
use crate::database::messages::SerializedMessage;
use crate::utils::{constants::cf, content_filter as cf_utils};

const MAX_RETRIES: u32 = 3;
const TEXT_PREFETCH_MIN_BATCH_SIZE: usize = 2;
const TEXT_PREFETCH_FALLBACK_PAUSE_MS: u64 = 15_000;
const TEXT_PREFETCH_OPENAI_MAX_RETRIES: u32 = 1;

struct CachedMessage {
    message: serenity::Message,
    cached_at: u64,
}

#[derive(Debug, Clone, Default)]
pub struct DiagnosticsFilters {
    pub guild_id: Option<String>,
    pub channel_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DiagnosticsStateSnapshot {
    pub channel_id: String,
    pub queue_depth: usize,
    pub scan_rate: f64,
    pub ewma_mpm: f64,
    pub false_positive_ratio: f64,
    pub tracked_users: usize,
    pub priority_users: usize,
    pub last_activity: u64,
}

#[derive(Debug, Clone)]
pub struct AutomatedDiagnostics {
    pub queue: super::types::QueueDiagnostics,
    pub states: Vec<DiagnosticsStateSnapshot>,
    pub dead_letters: super::types::DeadLetterDiagnostics,
    pub recent_dead_letters: Vec<super::types::DeadLetterEntry>,
}

static MESSAGE_CACHE: LazyLock<Mutex<HashMap<String, CachedMessage>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static ACTIVE_JOB_COUNT: AtomicUsize = AtomicUsize::new(0);
static TICK_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static LAST_HEARTBEAT_LOG_AT: AtomicU64 = AtomicU64::new(0);
static LOW_PRIORITY_DROP_LOG_WINDOW_UNTIL: AtomicU64 = AtomicU64::new(0);
static OPENAI_RATE_LIMIT_LOG_WINDOW_UNTIL: AtomicU64 = AtomicU64::new(0);
static TEXT_PREFETCH_PAUSED_UNTIL: AtomicU64 = AtomicU64::new(0);

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Starts the background job processing loops.
pub fn start(data: crate::Data, ctx: serenity::Context) {
    let tick_data = data.clone();
    let tick_ctx = ctx.clone();
    tokio::spawn(async move {
        info!("CF automated scanner started.");
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(cf::HEURISTIC_TICK_INTERVAL_MS)).await;
            tick(&tick_data, &tick_ctx).await;
        }
    });

    let cleanup_data = data.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(cf::AUTOMATED_CLEANUP_INTERVAL_MS)).await;
            state::prune();
            prune_message_cache();
            let _ = &cleanup_data; // keep ownership for future hooks
        }
    });

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(cf::AUTOMATED_METRICS_LOG_INTERVAL_MS)).await;
            let queue = scheduler::diagnostics();
            let (dead_total, dead_buffered) = dead_letter::get_summary();
            let states = state::count();
            let cache_size = recover_lock(&MESSAGE_CACHE).len();
            let now = now_ms();
            let has_signal = queue.total > 0 || dead_buffered > 0;
            let last_log = LAST_HEARTBEAT_LOG_AT.load(Ordering::Relaxed);
            if !has_signal && now.saturating_sub(last_log) < cf::AUTOMATED_HEARTBEAT_FORCED_LOG_INTERVAL_MS {
                continue;
            }
            LAST_HEARTBEAT_LOG_AT.store(now, Ordering::Relaxed);
            info!(
                "CF heartbeat: states={}, cache={}, queue_total={}, dead_total={}, dead_buffered={}",
                states, cache_size, queue.total, dead_total, dead_buffered
            );
        }
    });
}

/// Cache a message for later scan resolution.
pub fn cache_message(message: &serenity::Message) {
    recover_lock(&MESSAGE_CACHE).insert(
        message.id.to_string(),
        CachedMessage {
            message: message.clone(),
            cached_at: now_ms(),
        },
    );
}

/// Applies moderator feedback to channel-level false-positive priors.
pub fn handle_moderator_feedback(channel_id: &str, was_false: bool) {
    let channel_id = channel_id.to_string();

    state::update(&channel_id, None, |s| {
        let inc_a: f64 = if was_false { 1.0 } else { 0.0 };
        let inc_b: f64 = if was_false { 0.0 } else { 1.0 };

        let target_a = s.beta_a + inc_a.min(cf::HEURISTIC_MAX_BETA_INCREMENT_PER_CALL);
        let target_b = s.beta_b + inc_b.min(cf::HEURISTIC_MAX_BETA_INCREMENT_PER_CALL);

        s.beta_a = (s.beta_a * (1.0 - cf::HEURISTIC_SMOOTHED_FP_ALPHA)
            + target_a * cf::HEURISTIC_SMOOTHED_FP_ALPHA)
            .max(1.0);
        s.beta_b = (s.beta_b * (1.0 - cf::HEURISTIC_SMOOTHED_FP_ALPHA)
            + target_b * cf::HEURISTIC_SMOOTHED_FP_ALPHA)
            .max(1.0);
        // Note: beta_last_update is intentionally not updated here — matching TS behavior.
        // adjustScanRate handles beta decay independently based on elapsed time since last
        // scan rate adjustment, not moderator feedback events.
    });

    let state_opt = state::get(&channel_id);
    if let Some(state) = state_opt {
        let mean = beta_mean(&state);
        let prev = state::get_smoothed_false_positive(&channel_id);
        let smoothed = prev * (1.0 - cf::HEURISTIC_SMOOTHED_FP_ALPHA)
            + mean * cf::HEURISTIC_SMOOTHED_FP_ALPHA;
        state::set_smoothed_false_positive(&channel_id, smoothed);
    }
}

/// Fetch cached message if still fresh.
pub fn get_cached_message(message_id: &str) -> Option<serenity::Message> {
    let cutoff = now_ms().saturating_sub(cf::AUTOMATED_MESSAGE_CACHE_MAX_AGE_MS);
    let mut cache = recover_lock(&MESSAGE_CACHE);
    if let Some(entry) = cache.get(message_id) {
        if entry.cached_at >= cutoff {
            return Some(entry.message.clone());
        }
    }
    cache.remove(message_id);
    None
}

/// Returns scanner diagnostics for queue/state/dead-letter inspection.
///
pub fn get_diagnostics(filters: Option<DiagnosticsFilters>) -> AutomatedDiagnostics {
    let queue = scheduler::diagnostics();
    let mut states = state::list();

    if let Some(filters) = filters {
        if let Some(ref guild_id) = filters.guild_id {
            states.retain(|state| state.guild_id.as_deref() == Some(guild_id.as_str()));
        }
        if let Some(ref channel_id) = filters.channel_id {
            states.retain(|state| state.channel_id == *channel_id);
        }
    }

    let mut snapshots = states
        .into_iter()
        .map(|state| DiagnosticsStateSnapshot {
            queue_depth: scheduler::queue_depth_for_channel(&state.channel_id),
            channel_id: state.channel_id,
            scan_rate: state.scan_rate,
            ewma_mpm: state.ewma_mpm,
            false_positive_ratio: state.false_positive_ratio,
            tracked_users: state.user_scores.len(),
            priority_users: state.priority_alerted_users.len(),
            last_activity: state.last_activity,
        })
        .collect::<Vec<_>>();

    snapshots.sort_by(|a, b| b.last_activity.cmp(&a.last_activity));

    let (dead_total, dead_buffered) = dead_letter::get_summary();
    let dead_letters = super::types::DeadLetterDiagnostics {
        total_recorded: dead_total,
        buffered: dead_buffered,
    };

    AutomatedDiagnostics {
        queue,
        states: snapshots,
        dead_letters,
        recent_dead_letters: dead_letter::get_recent(10),
    }
}

fn prune_message_cache() {
    let cutoff = now_ms().saturating_sub(cf::AUTOMATED_MESSAGE_CACHE_MAX_AGE_MS);
    let mut cache = recover_lock(&MESSAGE_CACHE);
    cache.retain(|_, entry| entry.cached_at >= cutoff);
    if cache.len() > cf::AUTOMATED_MESSAGE_CACHE_MAX_SIZE {
        let mut entries: Vec<_> = cache.iter().map(|(k, v)| (k.clone(), v.cached_at)).collect();
        entries.sort_by_key(|(_, ts)| *ts);
        let to_remove = entries.len().saturating_sub(cf::AUTOMATED_MESSAGE_CACHE_MAX_SIZE);
        for (key, _) in entries.into_iter().take(to_remove) {
            cache.remove(&key);
        }
    }
}

/// Enqueues an automated scan job for a newly observed message.
pub async fn enqueue_for_scan(
    ctx: &serenity::Context,
    message: &serenity::Message,
    guild_config: &GuildConfig,
    serialized_message: &SerializedMessage,
) {
    let cf_config = match guild_config.parse_content_filter_config() {
        Some(c) => c,
        None => return,
    };

    let config = &cf_config.config;
    if !config.enabled || config.webhook_url.is_none() {
        return;
    }

    if !is_channel_in_scope(ctx, message, config).await {
        return;
    }

    if is_immune_author(ctx, message, config).await {
        return;
    }

    cache_message(message);

    let now = now_ms();
    let channel_id = message.channel_id.to_string();
    let guild_id = message.guild_id.map(|id| id.to_string()).unwrap_or_default();
    let is_prioritized = super::is_guild_prioritized(&guild_id);

    let mut measured_mpm = 0usize;
    state::update(&channel_id, Some(&guild_id), |s| {
        s.message_timestamps.push(now);
        s.message_timestamps.retain(|&ts| now.saturating_sub(ts) <= cf::HEURISTIC_SCAN_WINDOW);
        measured_mpm = s.message_timestamps.len();
        s.ewma_mpm = ewma(s.ewma_mpm, measured_mpm as f64, cf::HEURISTIC_EWMA_MPM_ALPHA);
    });

    let computed_risk = cf_utils::compute_message_risk(config, serialized_message);
    let risk = if is_prioritized { computed_risk.max(0.85) } else { computed_risk };
    let should_bypass_drop = is_prioritized || risk >= cf::AUTOMATED_LOW_PRIORITY_DROP_RISK_THRESHOLD;

    if !should_bypass_drop && scanner::openai_cooldown_remaining() > 0 {
        return;
    }
    if !should_bypass_drop && scheduler::size() >= cf::AUTOMATED_LOW_PRIORITY_DROP_QUEUE_SIZE {
        return;
    }
    if !should_bypass_drop && scheduler::queue_depth_for_guild(&guild_id) >= cf::AUTOMATED_MAX_GUILD_QUEUE_DEPTH {
        return;
    }

    let next_run_at = if is_prioritized {
        now
    } else {
        schedule_next_scan(now, state::get(&channel_id).map(|s| s.scan_rate).unwrap_or(cf::HEURISTIC_BASE_SCAN_RATE as f64), risk, measured_mpm as f64)
    };

    let job = ScanJob {
        job_id: uuid::Uuid::new_v4().to_string(),
        dedupe_key: format!("{}:{}:{}:automated", guild_id, channel_id, message.id),
        message_id: message.id.to_string(),
        channel_id,
        guild_id,
        author_id: message.author.id.to_string(),
        source: ScanSource::Automated,
        attempts: 0,
        max_attempts: MAX_RETRIES,
        enqueued_at: now,
        next_run_at,
        risk,
        is_retry: false,
        heuristic_signals: Vec::new(),
        force: is_prioritized,
    };

    scheduler::enqueue(job);
}

/// Enqueues a high-priority heuristic candidate for immediate sampling.
pub async fn enqueue_heuristic_candidate(
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &crate::config::schema::ContentFilterConfig,
    signals: Vec<String>,
    risk: f64,
) {
    if !config.enabled || config.webhook_url.is_none() {
        return;
    }

    if !is_channel_in_scope(ctx, message, config).await {
        return;
    }

    if is_immune_author(ctx, message, config).await {
        return;
    }

    cache_message(message);

    let now = now_ms();
    let channel_id = message.channel_id.to_string();
    let guild_id = message.guild_id.map(|id| id.to_string()).unwrap_or_default();

    let job = ScanJob {
        job_id: uuid::Uuid::new_v4().to_string(),
        dedupe_key: format!("{}:{}:{}:heuristic", guild_id, channel_id, message.id),
        message_id: message.id.to_string(),
        channel_id,
        guild_id,
        author_id: message.author.id.to_string(),
        source: ScanSource::Heuristic,
        attempts: 0,
        max_attempts: MAX_RETRIES,
        enqueued_at: now,
        next_run_at: now,
        risk: risk.max(0.6),
        is_retry: false,
        heuristic_signals: signals,
        force: true,
    };

    scheduler::enqueue(job);
}

async fn tick(data: &crate::Data, ctx: &serenity::Context) {
    if TICK_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return;
    }

    let now = now_ms();
    prune_message_cache();

    let available_slots = cf::AUTOMATED_MAX_CONCURRENT_JOBS.saturating_sub(ACTIVE_JOB_COUNT.load(Ordering::Relaxed));
    if available_slots == 0 {
        TICK_IN_FLIGHT.store(false, Ordering::SeqCst);
        return;
    }

    let openai_cooldown = scanner::openai_cooldown_remaining();
    if openai_cooldown > 0 && !scheduler::has_due_forced_job(now) {
        TICK_IN_FLIGHT.store(false, Ordering::SeqCst);
        return;
    }

    let global_rate = (state::aggregate_scan_rate_estimate(get_dynamic_base_scan_rate_for_state)
        .round() as u32)
        .clamp(cf::HEURISTIC_BASE_SCAN_RATE, cf::HEURISTIC_MAX_SCAN_RATE);

    let scans_per_second = global_rate as f64 / 60.0;
    let tick_duration = cf::HEURISTIC_TICK_INTERVAL_MS as f64 / 1000.0;
    let allowed_scans = (scans_per_second * tick_duration).floor().max(1.0) as usize;
    let job_budget = if openai_cooldown > 0 {
        allowed_scans.min(1).min(available_slots)
    } else {
        allowed_scans.min(available_slots)
    };

    let jobs = scheduler::pull_due(now, job_budget);
    if jobs.is_empty() {
        TICK_IN_FLIGHT.store(false, Ordering::SeqCst);
        return;
    }

    let mut prefetched_by_index: HashMap<usize, Vec<serde_json::Value>> = HashMap::new();
    let text_batch: Vec<(usize, String)> = jobs
        .iter()
        .enumerate()
        .filter_map(|(idx, job)| {
            let cached = get_cached_message(&job.message_id)?;
            let text = cached.content.trim();
            if text.is_empty() {
                return None;
            }
            Some((idx, text.to_string()))
        })
        .collect();

    let can_prefetch = openai_cooldown == 0
        && text_batch.len() >= TEXT_PREFETCH_MIN_BATCH_SIZE
        && now >= TEXT_PREFETCH_PAUSED_UNTIL.load(Ordering::Relaxed);

    if can_prefetch {
        match scanner::batch_scan_text(
            &data.http_client,
            &data.env.openai_api_key,
            text_batch.iter().map(|(_, t)| t.as_str()).collect(),
            TEXT_PREFETCH_OPENAI_MAX_RETRIES,
        )
        .await
        {
            Ok(results) => {
                for (result_idx, (job_idx, _)) in text_batch.iter().enumerate() {
                    if let Some(item) = results.get(result_idx) {
                        prefetched_by_index.insert(*job_idx, vec![item.clone()]);
                    }
                }
            }
            Err(e) => {
                // Use max(fallback, hinted retry) — matching TS behavior where
                // retryAfterMs from a RetryableScanError is respected if larger.
                let hinted = get_retry_after_ms(&e).unwrap_or(0);
                let pause = TEXT_PREFETCH_FALLBACK_PAUSE_MS.max(hinted);
                TEXT_PREFETCH_PAUSED_UNTIL.store(now + pause, Ordering::Relaxed);
                warn!("CF text batch prefetch failed: {e}");
            }
        }
    }

    for (idx, job) in jobs.into_iter().enumerate() {
        let data = data.clone();
        let ctx = ctx.clone();
        let prefetched = prefetched_by_index.remove(&idx);
        ACTIVE_JOB_COUNT.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(async move {
            if let Err(e) = process_job(job, now, prefetched, &data, &ctx).await {
                error!("CF job processing failed: {e}");
            }
            // TS: Math.max(0, this._activeJobCount - 1) — saturate at 0 to avoid underflow.
            let _ = ACTIVE_JOB_COUNT.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                Some(v.saturating_sub(1))
            });
        });
    }

    TICK_IN_FLIGHT.store(false, Ordering::SeqCst);
}

async fn process_job(
    job: ScanJob,
    now: u64,
    prefetched_text: Option<Vec<serde_json::Value>>,
    data: &crate::Data,
    ctx: &serenity::Context,
) -> Result<(), String> {
    let process_result: Result<(), String> = async {
        if cf_utils::alert_exists_for_message(&data.db, &job.message_id)
            .await
            .unwrap_or(false)
        {
            return Ok(());
        }

        let message = match resolve_message(&job, ctx).await {
            Some(m) => m,
            None => return Ok(()),
        };

        let guild_id = match job.guild_id.parse::<u64>() {
            Ok(id) => serenity::GuildId::new(id),
            Err(_) => return Ok(()),
        };

        let config = data.config_manager.get_guild_config(&data.db, guild_id).await;
        let cf_config = match config.parse_content_filter_config() {
            Some(c) => c,
            None => return Ok(()),
        };

        let prep = match prepare_channel_for_scan(
            &data.db,
            ctx,
            &message,
            &cf_config.config,
            now,
            Some(job.risk),
            job.force,
        )
        .await
        {
            Some(p) => p,
            None => return Ok(()),
        };

        if !prep.should_scan {
            return Ok(());
        }

        let bypass_cooldown = job.force
            && scanner::openai_cooldown_remaining() <= cf::AUTOMATED_FORCE_COOLDOWN_BYPASS_WINDOW_MS;

        let mut predictions = scanner::run_detectors(
            &data.http_client,
            &data.env.openai_api_key,
            ctx,
            &message,
            &cf_config.config,
            prep.state.as_ref(),
            prefetched_text.as_deref(),
            bypass_cooldown,
        )
        .await
        .map_err(|e| e.to_string())?;

        if job.source == ScanSource::Heuristic && !job.heuristic_signals.is_empty() {
            let mut data_points = Vec::new();
            for signal in &job.heuristic_signals {
                data_points.push(ContentPredictionData {
                    content: signal.clone(),
                    score: None,
                    category: None,
                });
            }
            predictions.push(ContentPredictions {
                data: data_points,
                detector: None,
                content: Vec::new(),
            });
        }

        if predictions.is_empty() {
            return Ok(());
        }

        apply_predictions_to_state(
            &job.channel_id,
            &job.author_id,
            predictions.as_slice(),
            now,
            prep.risk_score,
            prep.smoothed,
        );

        let scan_type = if job.source == ScanSource::Heuristic {
            "Heuristic Scan"
        } else {
            "Automated Scan"
        };

        scanner::create_alert(
            &data.db,
            &data.http_client,
            ctx,
            &message,
            predictions,
            scan_type,
            &cf_config.config,
        )
        .await
        .map_err(|e| e.to_string())?;

        if adjust_scan_rate(&job.channel_id, now, prep.smoothed) && cf_config.config.verbosity == crate::config::schema::ContentFilterVerbosity::Verbose {
            // Read the updated scan rate from state (post-adjustment), matching TS which passes
            // prep.state.scanRate (already updated by adjustScanRate).
            let new_rate = state::get(&job.channel_id)
                .map(|s| s.scan_rate)
                .unwrap_or(cf::HEURISTIC_BASE_SCAN_RATE as f64);
            send_scan_rate_change_log(ctx, &message, &cf_config.config, new_rate).await;
        }

        Ok(())
    }
    .await;

    if let Err(reason) = process_result {
        handle_job_failure(&job, &reason, now, data).await;
    }
    Ok(())
}

async fn handle_job_failure(job: &ScanJob, reason: &str, now: u64, data: &crate::Data) {
    let next_attempt = job.attempts + 1;
    let is_retryable_error = is_transient_retryable_error(reason) || is_openai_rate_limit_error(reason);
    let is_openai_rate_limit = is_openai_rate_limit_error(reason);

    if should_drop_low_priority_job(job, reason) {
        let should_log = now >= LOW_PRIORITY_DROP_LOG_WINDOW_UNTIL.load(Ordering::Relaxed);
        LOW_PRIORITY_DROP_LOG_WINDOW_UNTIL.store(
            now + cf::AUTOMATED_LOW_PRIORITY_DROP_LOG_WINDOW_MS,
            Ordering::Relaxed,
        );
        if should_log {
            warn!(
                "CF dropped low-priority jobs under rate-limit pressure: queue_depth={}",
                scheduler::size()
            );
        }
        return;
    }

    if is_openai_rate_limit {
        let hinted_retry_after = get_retry_after_ms(reason).unwrap_or_else(|| {
            (cf::AUTOMATED_RETRY_BASE_DELAY_MS
                * 2u64.saturating_pow(job.attempts))
            .min(cf::AUTOMATED_RETRY_MAX_DELAY_MS)
        });
        let min_retry_after = if job.force {
            cf::AUTOMATED_OPENAI_RATE_LIMIT_MIN_RETRY_MS_FORCED
        } else {
            cf::AUTOMATED_OPENAI_RATE_LIMIT_MIN_RETRY_MS
        };
        let retry_after = hinted_retry_after.max(min_retry_after);
        let jitter_max = (retry_after as f64 * 0.2).max(1000.0) as u64;
        let jitter = if jitter_max > 0 {
            rand::random::<u64>() % jitter_max
        } else {
            0
        };

        let mut retry_job = job.clone();
        retry_job.next_run_at = now + retry_after + jitter;
        retry_job.is_retry = true;
        retry_job.attempts = job.attempts;
        scheduler::enqueue(retry_job);

        let window_ends_at = now + retry_after.max(1000);
        let previous_window = OPENAI_RATE_LIMIT_LOG_WINDOW_UNTIL.load(Ordering::Relaxed);
        let should_log = now >= previous_window;
        OPENAI_RATE_LIMIT_LOG_WINDOW_UNTIL.store(
            previous_window.max(window_ends_at),
            Ordering::Relaxed,
        );

        if should_log {
            warn!(
                "CF OpenAI rate limit hit: deferred=true retry_after={}ms queue_depth={}",
                retry_after,
                scheduler::size()
            );
        }
        return;
    }

    if !is_retryable_error || next_attempt >= job.max_attempts {
        let reason_code = if is_retryable_error {
            "max-retries-exceeded"
        } else {
            "non-retryable-failure"
        };
        dead_letter::record(&data.kv, job, reason_code, Some(reason)).await;
        return;
    }

    let retry_after = get_retry_after_ms(reason).unwrap_or_else(|| {
        (cf::AUTOMATED_RETRY_BASE_DELAY_MS * 2u64.saturating_pow(job.attempts))
            .min(cf::AUTOMATED_RETRY_MAX_DELAY_MS)
    });
    let jitter_max = (retry_after as f64 * 0.2).max(1000.0) as u64;
    let jitter = if jitter_max > 0 {
        rand::random::<u64>() % jitter_max
    } else {
        0
    };
    let next_run_at = now + retry_after + jitter;

    let mut retry_job = job.clone();
    retry_job.next_run_at = next_run_at;
    retry_job.attempts = next_attempt;
    retry_job.is_retry = true;
    scheduler::enqueue(retry_job);

    warn!(
        "CF scan job scheduled for retry: job_id={} source={} message_id={} channel_id={} attempts={}/{} next_run_at={} reason={}",
        job.job_id,
        job.source,
        job.message_id,
        job.channel_id,
        next_attempt,
        job.max_attempts,
        next_run_at,
        reason
    );
}

fn is_transient_retryable_error(reason: &str) -> bool {
    let normalized = reason.to_lowercase();

    if let Some(status) = extract_status_code(&normalized) {
        if matches!(status, 408 | 409 | 425 | 429) {
            return true;
        }
        if (500..=599).contains(&status) {
            return true;
        }
    }

    // "retry after NNNms" is how the Rust scanner encodes retryable errors
    // (e.g. webhook dispatch failures, OCR failures), matching the TS pattern of
    // throwing RetryableScanError which is always retryable.
    if normalized.contains("retry after") {
        return true;
    }

    normalized.contains("timed out")
        || normalized.contains("timeout")
        || normalized.contains("reset")
        || normalized.contains("econn")
        || normalized.contains("eai_again")
        || normalized.contains("aborterror")
        || normalized.contains("timeouterror")
        || normalized.contains("network")
        || normalized.contains("socket hang up")
        || normalized.contains("temporarily unavailable")
}

fn should_drop_low_priority_job(job: &ScanJob, reason: &str) -> bool {
    if !is_openai_rate_limit_error(reason) {
        return false;
    }
    if job.source != ScanSource::Automated {
        return false;
    }
    if job.force {
        return false;
    }
    if job.risk >= cf::AUTOMATED_LOW_PRIORITY_DROP_RISK_THRESHOLD {
        return false;
    }
    scheduler::size() >= cf::AUTOMATED_LOW_PRIORITY_DROP_QUEUE_SIZE
}

fn is_openai_rate_limit_error(reason: &str) -> bool {
    let normalized = reason.to_lowercase();
    if normalized.contains("status 429") {
        return true;
    }
    normalized.contains("openai")
        && (normalized.contains("rate limit") || normalized.contains("rate-limited"))
}

fn extract_status_code(normalized_reason: &str) -> Option<u16> {
    static STATUS_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"status\s+([0-9]{3})").expect("valid status regex"));
    let caps = STATUS_RE.captures(normalized_reason)?;
    caps.get(1)?.as_str().parse::<u16>().ok()
}

fn get_retry_after_ms(reason: &str) -> Option<u64> {
    let normalized = reason.to_lowercase();

    static OPENAI_FOR_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"openai\s+rate-?limited\s+for\s+([0-9]+)\s*ms").expect("valid retry regex")
    });
    if let Some(caps) = OPENAI_FOR_RE.captures(&normalized) {
        if let Ok(ms) = caps.get(1)?.as_str().parse::<u64>() {
            return Some(ms.max(1000));
        }
    }

    static RETRY_AFTER_RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"retry after\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|seconds)?")
            .expect("valid retry-after regex")
    });
    if let Some(caps) = RETRY_AFTER_RE.captures(&normalized) {
        let raw = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<f64>().ok())
            .unwrap_or(0.0);
        if raw > 0.0 {
            let unit = caps.get(2).map(|m| m.as_str()).unwrap_or("s");
            let multiplier = if unit == "ms" { 1.0 } else { 1000.0 };
            return Some((raw * multiplier).round().max(1000.0) as u64);
        }
    }

    None
}

async fn resolve_message(job: &ScanJob, ctx: &serenity::Context) -> Option<serenity::Message> {
    if let Some(cached) = get_cached_message(&job.message_id) {
        return Some(cached);
    }

    let channel_id: u64 = job.channel_id.parse().ok()?;
    let message_id: u64 = job.message_id.parse().ok()?;
    let channel_id = serenity::ChannelId::new(channel_id);
    let message_id = serenity::MessageId::new(message_id);

    let fetched = channel_id.message(ctx, message_id).await.ok()?;
    cache_message(&fetched);
    Some(fetched)
}

struct PreparedScan {
    state: Option<crate::content_filter::types::ChannelScanState>,
    should_scan: bool,
    smoothed: f64,
    risk_score: f64,
}

async fn prepare_channel_for_scan(
    db: &sea_orm::DatabaseConnection,
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &crate::config::schema::ContentFilterConfig,
    now: u64,
    risk_override: Option<f64>,
    force: bool,
) -> Option<PreparedScan> {
    if !config.enabled || config.webhook_url.is_none() {
        return None;
    }

    if is_immune_author(ctx, message, config).await {
        return None;
    }

    let guild_id = message.guild_id.map(|id| id.to_string()).unwrap_or_default();
    let channel_id = message.channel_id.to_string();
    let is_prioritized = super::is_guild_prioritized(&guild_id);

    let mut state_clone = state::get_or_init(&channel_id, Some(&guild_id));
    cleanup_old_timestamps(&mut state_clone, now, cf::CONTENT_FILTER_ALERT_TTL);

    let mut effective_risk = risk_override;
    let mut traffic_estimate = cf::AUTOMATED_DEFAULT_TRAFFIC_ESTIMATE;
    let mut false_positive_ratio = 0.0f64;

    let traffic = state_clone.ewma_mpm.max(1.0).round();
    let window_ms = (cf::HEURISTIC_WINDOW_BASE_MS as f64 * (cf::HEURISTIC_BASE_SCAN_RATE as f64 / traffic))
        .round()
        .clamp(cf::HEURISTIC_WINDOW_MIN_MS as f64, cf::HEURISTIC_WINDOW_MAX_MS as f64);
    let window_start = chrono::DateTime::from_timestamp_millis(now as i64)
        .unwrap_or_else(chrono::Utc::now)
        - chrono::Duration::milliseconds(window_ms as i64);

    if let Ok((_alerts, ratio, highest)) = cf_utils::get_recent_alerts_and_false_positive_ratio(
        db,
        &guild_id,
        &channel_id,
        window_start,
    )
    .await
    {
        false_positive_ratio = ratio;
        traffic_estimate = traffic.max(1.0);
        if highest > 0.0 && effective_risk.is_none() {
            effective_risk = Some((highest / 10.0).min(1.0));
        }
    }

    let prev_smoothed = state::get_smoothed_false_positive(&channel_id);
    let smoothed = prev_smoothed * (1.0 - cf::HEURISTIC_SMOOTHED_FP_ALPHA)
        + false_positive_ratio * cf::HEURISTIC_SMOOTHED_FP_ALPHA;
    state::set_smoothed_false_positive(&channel_id, smoothed);

    let decay = compute_decay_factor(&state_clone, smoothed);
    let priority_threshold = compute_priority_threshold(&state_clone, smoothed);
    let mut user_entry = state_clone
        .user_scores
        .get(&message.author.id.to_string())
        .cloned()
        .unwrap_or(crate::content_filter::types::UserScoreEntry { score: 0.0, last_scan: 0 });

    if user_entry.score > 0.0 {
        user_entry.score *= decay;
        state_clone
            .user_scores
            .insert(message.author.id.to_string(), user_entry.clone());
    }

    let is_priority_user = user_entry.score >= priority_threshold;
    let risk_score = effective_risk.unwrap_or(0.5);
    let mut should_scan = force || is_prioritized;

    // TS mutates the live state before the sampling decision. Persist the cleanup and
    // user-score decay even when this message is ultimately not scanned.
    state::update(&channel_id, Some(&guild_id), |s| {
        s.scan_timestamps = state_clone.scan_timestamps.clone();
        s.flagged_users = state_clone.flagged_users.clone();
        s.user_scores = state_clone.user_scores.clone();
    });

    if !should_scan {
        if is_priority_user {
            should_scan = true;
        } else {
            let base_scan_rate = get_dynamic_base_scan_rate_for_state(&state_clone);
            let sampling_factor = risk_score.clamp(cf::HEURISTIC_MIN_SAMPLING_FACTOR, 1.0);
            let probability = ((base_scan_rate / traffic_estimate.max(1.0)) * sampling_factor).min(1.0);
            should_scan = rand::random::<f64>() < probability;
        }
    }

    if !should_scan && !force {
        // TS returns early here without mutating state — match that behavior.
        return Some(PreparedScan { state: Some(state_clone), should_scan: false, smoothed, risk_score });
    }

    state::update(&channel_id, Some(&guild_id), |s| {
        user_entry.last_scan = now;
        s.user_scores.insert(message.author.id.to_string(), user_entry.clone());
        s.scan_timestamps.push(now);
        s.false_positive_ratio = smoothed;
    });

    if is_priority_user && config.verbosity != crate::config::schema::ContentFilterVerbosity::Minimal {
        // Only send warning once per priority escalation event (deduplication matches TS behavior).
        let already_alerted = state::get(&channel_id)
            .map(|s| s.priority_alerted_users.contains(&message.author.id.to_string()))
            .unwrap_or(false);
        if !already_alerted {
            state::update(&channel_id, Some(&guild_id), |s| {
                s.priority_alerted_users.insert(message.author.id.to_string());
            });
            send_priority_user_warning(ctx, message, config).await;
        }
    } else if !is_priority_user {
        state::update(&channel_id, Some(&guild_id), |s| {
            s.priority_alerted_users.remove(&message.author.id.to_string());
        });
    }

    let state_after = state::get(&channel_id);
    Some(PreparedScan {
        state: state_after,
        should_scan: true,
        smoothed,
        risk_score,
    })
}

fn apply_predictions_to_state(
    channel_id: &str,
    author_id: &str,
    predictions: &[ContentPredictions],
    now: u64,
    risk_score: f64,
    smoothed_false_positive: f64,
) {
    state::update(channel_id, None, |s| {
        s.alert_count += 1;
        let mut timestamps = s.flagged_users.get(author_id).cloned().unwrap_or_default();
        timestamps.retain(|ts| now.saturating_sub(*ts) < cf::HEURISTIC_SCAN_WINDOW);
        timestamps.push(now);
        s.flagged_users.insert(author_id.to_string(), timestamps);

        let decay = compute_decay_factor(s, smoothed_false_positive);
        let mut entry = s.user_scores.get(author_id).cloned().unwrap_or(crate::content_filter::types::UserScoreEntry {
            score: 0.0,
            last_scan: now,
        });

        let detector_weight = (1 + predictions.len()).min(3) as f64;
        let severity = (predictions.iter().flat_map(|p| p.data.iter()).count().max(1) as f64 / 3.0).min(1.0);
        let dynamic_weight = compute_dynamic_weight(detector_weight, severity, risk_score);

        entry.score = entry.score * decay + dynamic_weight;
        entry.last_scan = now;
        s.user_scores.insert(author_id.to_string(), entry);
        s.false_positive_ratio = smoothed_false_positive;
    });
}

fn adjust_scan_rate(channel_id: &str, now: u64, smoothed_false_positive: f64) -> bool {
    let mut should_log = false;
    state::update(channel_id, None, |s| {
        let mut pid = get_pid_state(channel_id);

        let dt_ms = now.saturating_sub(s.beta_last_update);
        if dt_ms > 0 {
            let decay_factor = (-std::f64::consts::LN_2 * (dt_ms as f64 / cf::HEURISTIC_BETA_DECAY_HALF_LIFE_MS as f64)).exp();
            s.beta_a = (s.beta_a * decay_factor).max(1.0);
            s.beta_b = (s.beta_b * decay_factor).max(1.0);
            s.beta_last_update = now;
        }

        let beta = beta_mean(s);
        let ewma_mpm = s.ewma_mpm.max(1.0).round();
        // TS: 1 + Math.min(2, Math.log10(1 + ewmaMpm) * 0.25)
        let traffic_scale = 1.0 + ((1.0 + ewma_mpm).log10() * 0.25).min(2.0);

        let mut kp = cf::HEURISTIC_PID_BASE_KP * (1.0 + (1.0 - beta) * 0.4) * traffic_scale;
        kp = kp.clamp(cf::HEURISTIC_PID_KP_MIN, cf::HEURISTIC_PID_KP_MAX);

        // TS: HEURISTIC_PID_BASE_KI / Math.max(1, Math.log10(1 + ewmaMpm) * 0.5)
        let mut ki = cf::HEURISTIC_PID_BASE_KI / ((1.0 + ewma_mpm).log10() * 0.5).max(1.0);
        ki = ki.clamp(cf::HEURISTIC_PID_KI_MIN, cf::HEURISTIC_PID_KI_MAX);

        // TS: HEURISTIC_PID_BASE_KD * (1 + Math.min(1, Math.log10(1 + ewmaMpm) * 0.1))
        let mut kd = cf::HEURISTIC_PID_BASE_KD * (1.0 + ((1.0 + ewma_mpm).log10() * 0.1).min(1.0));
        kd = kd.clamp(cf::HEURISTIC_PID_KD_MIN, cf::HEURISTIC_PID_KD_MAX);

        // TS: Math.max(1, Math.round(STEP * (1 + (1 - Math.min(1, smoothedFalsePositive)))))
        let max_step = (cf::HEURISTIC_RATE_INCREASE_STEP as f64 * (1.0 + (1.0 - smoothed_false_positive.min(1.0)))).round().max(1.0);

        let base_rate = get_dynamic_base_scan_rate_for_state(s);
        let min_rate = base_rate.max(cf::HEURISTIC_MIN_SCAN_RATE as f64);
        let adaptive_threshold = estimate_adaptive_threshold(&s.scan_timestamps, now);
        let error = s.alert_count as f64 - adaptive_threshold as f64;

        let dt = ((now.saturating_sub(pid.last_update)) as f64 / 1000.0).max(1.0);
        pid.integral += error * dt;
        let derivative = (error - pid.last_error) / dt;
        let output = kp * error + ki * pid.integral + kd * derivative;

        let mut step = output.round().clamp(-max_step, max_step);
        if step == 0.0 && error != 0.0 {
            step = if error > 0.0 { 1.0 } else { -1.0 };
        }

        let previous_rate = s.scan_rate;
        s.scan_rate = (s.scan_rate + step).clamp(min_rate, cf::HEURISTIC_MAX_SCAN_RATE as f64);

        if s.scan_rate > previous_rate {
            s.last_rate_increase = now;
        }

        let mut changed = false;
        if (s.scan_rate - previous_rate).abs() > f64::EPSILON {
            s.alert_count = 0;
            changed = true;
        }

        pid.last_error = error;
        pid.last_update = now;
        set_pid_state(channel_id, pid);

        if s.scan_rate > base_rate && now.saturating_sub(s.last_rate_increase) > cf::HEURISTIC_RATE_INCREASE_DURATION {
            s.scan_rate = (s.scan_rate * cf::HEURISTIC_RATE_DECAY_A + base_rate * cf::HEURISTIC_RATE_DECAY_B).round().max(base_rate);
            s.last_rate_increase = now;
            s.alert_count = 0;
            changed = true;
        }

        let abs_change = (s.scan_rate - s.logged_rate_ewma).abs();
        if changed && abs_change >= cf::HEURISTIC_MIN_ABS_CHANGE_FOR_LOG {
            if s.last_rate_log == 0 {
                s.last_rate_log = now;
            } else if now.saturating_sub(s.last_rate_log) > cf::HEURISTIC_RATE_CHANGE_INTERVAL {
                should_log = true;
                s.last_rate_log = now;
            }
        }

        s.logged_rate_ewma = (s.logged_rate_ewma * (1.0 - cf::HEURISTIC_LOGGING_SMOOTH_ALPHA)
            + s.scan_rate * cf::HEURISTIC_LOGGING_SMOOTH_ALPHA)
            .round();
    });

    should_log
}

fn cleanup_old_timestamps(state: &mut crate::content_filter::types::ChannelScanState, now: u64, ttl: u64) {
    state.scan_timestamps.retain(|ts| now.saturating_sub(*ts) < cf::HEURISTIC_SCAN_WINDOW);

    state.flagged_users.retain(|_, timestamps| {
        timestamps.retain(|ts| now.saturating_sub(*ts) < cf::HEURISTIC_SCAN_WINDOW);
        !timestamps.is_empty()
    });

    let user_keys: Vec<String> = state
        .user_scores
        .iter()
        .filter(|(_, entry)| {
            let stale_small = entry.score <= cf::HEURISTIC_SCORE_PRUNE_EPSILON
                && now.saturating_sub(entry.last_scan) > cf::HEURISTIC_SCAN_WINDOW;
            let stale_ttl = now.saturating_sub(entry.last_scan) > ttl;
            !(stale_small || stale_ttl)
        })
        .map(|(k, _)| k.clone())
        .collect();

    state.user_scores.retain(|k, _| user_keys.contains(k));

    if state.user_scores.len() > cf::HEURISTIC_USER_SCORES_MAX_SIZE {
        let mut candidates: Vec<_> = state
            .user_scores
            .iter()
            .map(|(k, v)| (k.clone(), v.last_scan))
            .collect();
        candidates.sort_by_key(|(_, ts)| *ts);
        let target = (cf::HEURISTIC_USER_SCORES_MAX_SIZE as f64 * 0.9).floor() as usize;
        for (key, _) in candidates.into_iter().take(state.user_scores.len().saturating_sub(target)) {
            state.user_scores.remove(&key);
        }
    }
}

fn compute_dynamic_weight(detector_weight: f64, severity: f64, risk_score: f64) -> f64 {
    let weighted = detector_weight
        * (cf::HEURISTIC_DYNAMIC_WEIGHT_BASE + severity * cf::HEURISTIC_DYNAMIC_WEIGHT_SEVERITY_MULT)
        * (1.0 + risk_score.min(1.0));

    weighted.clamp(cf::HEURISTIC_DYNAMIC_WEIGHT_MIN, cf::HEURISTIC_DYNAMIC_WEIGHT_MAX)
}

fn compute_decay_factor(state: &crate::content_filter::types::ChannelScanState, smoothed_fp: f64) -> f64 {
    let base = cf::HEURISTIC_DECAY_BASE;
    let fp_influence = (smoothed_fp * cf::HEURISTIC_DECAY_FP_INFLUENCE_FACTOR)
        .min(cf::HEURISTIC_DECAY_FP_INFLUENCE_MAX);
    let alert_influence = (state.alert_count as f64 * cf::HEURISTIC_DECAY_ALERT_INFLUENCE_PER_ALERT)
        .min(cf::HEURISTIC_DECAY_ALERT_INFLUENCE_MAX);

    (base - fp_influence - alert_influence).clamp(cf::HEURISTIC_DECAY_MIN, cf::HEURISTIC_DECAY_MAX)
}

fn compute_priority_threshold(state: &crate::content_filter::types::ChannelScanState, smoothed_fp: f64) -> f64 {
    let base = cf::HEURISTIC_PRIORITY_USER_FLAG_THRESHOLD.max(1) as f64;
    let multiplier = 1.0
        + (smoothed_fp * cf::HEURISTIC_PRIORITY_MULT_FACTOR)
            .min(cf::HEURISTIC_PRIORITY_MULT_MAX);
    let recent_alerts = state.scan_timestamps.len() as f64;
    // TS: Math.max(0, 1 - Math.min(0.5, recentAlerts / CAP))
    let recent_influence = (1.0 - (recent_alerts / cf::HEURISTIC_RECENT_ALERTS_CAP).min(0.5)).max(0.0);

    (base * multiplier * recent_influence).max(1.0).ceil()
}

fn beta_mean(state: &crate::content_filter::types::ChannelScanState) -> f64 {
    let mean = state.beta_a / (state.beta_a + state.beta_b);
    mean.clamp(cf::HEURISTIC_BETA_MEAN_MIN, cf::HEURISTIC_BETA_MEAN_MAX)
}

fn get_dynamic_base_scan_rate_for_state(state: &crate::content_filter::types::ChannelScanState) -> f64 {
    let ewma = state.ewma_mpm;
    let beta = beta_mean(state);
    let raw = cf::HEURISTIC_K_TRAFFIC * ewma
        + cf::HEURISTIC_K_CONF * (1.0 - beta) * cf::HEURISTIC_BASE_SCAN_RATE as f64;
    // Match TS: `raw || HEURISTIC_BASE_SCAN_RATE` — fall back to base rate when raw rounds to 0.
    let resolved = if raw.round() == 0.0 { cf::HEURISTIC_BASE_SCAN_RATE as f64 } else { raw.round() };
    resolved
        .max(cf::HEURISTIC_MIN_SCAN_RATE as f64)
        .min(cf::HEURISTIC_MAX_SCAN_RATE as f64)
}

fn estimate_adaptive_threshold(timestamps: &[u64], now: u64) -> u64 {
    if timestamps.is_empty() {
        return 1;
    }

    let alpha = cf::HEURISTIC_ADAPTIVE_DECAY_ALPHA.clamp(0.0, 1.0);
    let mut histogram: HashMap<u64, f64> = HashMap::new();
    let mut total_weight = 0.0;

    for i in 0..cf::HEURISTIC_ADAPTIVE_P95_WINDOWS {
        let start = now.saturating_sub(((i + 1) as u64) * cf::HEURISTIC_SCAN_WINDOW);
        let end = now.saturating_sub(i as u64 * cf::HEURISTIC_SCAN_WINDOW);
        let count = timestamps.iter().filter(|&&ts| ts > start && ts <= end).count() as u64;
        let weight = alpha.powi(i as i32);
        *histogram.entry(count).or_insert(0.0) += weight;
        total_weight += weight;
    }

    let mut entries: Vec<(u64, f64)> = histogram.into_iter().collect();
    entries.sort_by_key(|(count, _)| *count);

    let target = total_weight * 0.95;
    let mut cumulative = 0.0;
    let mut p95 = 0u64;
    for (count, weight) in entries {
        cumulative += weight;
        p95 = count;
        if cumulative >= target {
            break;
        }
    }

    (p95 + 1).max(1)
}

fn schedule_next_scan(now: u64, scan_rate: f64, risk: f64, observed_traffic: f64) -> u64 {
    // TS: effectiveRate = Math.min(scanRate, observedTraffic ?? scanRate)
    let effective_rate = scan_rate.min(observed_traffic);
    let msgs_per_minute = effective_rate.max(cf::HEURISTIC_MIN_SCAN_RATE as f64).round();
    let base_interval = cf::HEURISTIC_SCAN_WINDOW as f64 / msgs_per_minute;

    let risk_clamped = risk.clamp(0.0, 1.0);
    let multiplier = cf::HEURISTIC_RISK_MULTIPLIER_MIN
        + (1.0 - risk_clamped) * (cf::HEURISTIC_RISK_MULTIPLIER_MAX - cf::HEURISTIC_RISK_MULTIPLIER_MIN);

    let jitter_max = (base_interval * cf::HEURISTIC_JITTER_PCT).min(1000.0).floor() as u64;
    let jitter = if jitter_max > 0 { rand::random::<u64>() % jitter_max } else { 0 };

    now + ((base_interval * multiplier).floor() as u64)
        .max(cf::HEURISTIC_MIN_SCHEDULE_DELAY)
        + jitter
}

fn ewma(prev: f64, value: f64, alpha: f64) -> f64 {
    prev * (1.0 - alpha) + value * alpha
}

#[derive(Clone, Debug)]
struct PidState {
    integral: f64,
    last_error: f64,
    last_update: u64,
}

static PID_STATE: LazyLock<Mutex<HashMap<String, PidState>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

fn get_pid_state(channel_id: &str) -> PidState {
    recover_lock(&PID_STATE)
        .entry(channel_id.to_string())
        .or_insert(PidState {
            integral: 0.0,
            last_error: 0.0,
            last_update: now_ms(),
        })
        .clone()
}

fn set_pid_state(channel_id: &str, pid: PidState) {
    recover_lock(&PID_STATE).insert(channel_id.to_string(), pid);
}

async fn is_channel_in_scope(
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &crate::config::schema::ContentFilterConfig,
) -> bool {
    if config.channel_scoping.is_empty() {
        return true;
    }

    let Some(guild_channel) = message
        .channel_id
        .to_channel(ctx)
        .await
        .ok()
        .and_then(|c| c.guild())
    else {
        return false;
    };

    let is_thread = matches!(
        guild_channel.kind,
        serenity::ChannelType::PublicThread
            | serenity::ChannelType::PrivateThread
            | serenity::ChannelType::NewsThread
    );

    let (scope_channel_id, thread_id, category_id) = if is_thread {
        let thread_id = Some(guild_channel.id.to_string());
        match guild_channel.parent_id {
            Some(parent_channel_id) => {
                let category_id = parent_channel_id
                    .to_channel(ctx)
                    .await
                    .ok()
                    .and_then(|c| c.guild())
                    .and_then(|c| c.parent_id)
                    .map(|id| id.to_string());

                (parent_channel_id.to_string(), thread_id, category_id)
            }
            None => (guild_channel.id.to_string(), thread_id, None),
        }
    } else {
        (
            guild_channel.id.to_string(),
            None,
            guild_channel.parent_id.map(|id| id.to_string()),
        )
    };

    let parsed = crate::utils::ChannelScoping {
        included: config
            .channel_scoping
            .iter()
            .filter(|s| s.scoping_type == crate::config::schema::ChannelScopingType::Include)
            .map(|s| s.channel_id.clone())
            .collect(),
        excluded: config
            .channel_scoping
            .iter()
            .filter(|s| s.scoping_type == crate::config::schema::ChannelScopingType::Exclude)
            .map(|s| s.channel_id.clone())
            .collect(),
    };

    crate::utils::channel_in_scope_resolved(
        &scope_channel_id,
        thread_id.as_deref(),
        category_id.as_deref(),
        &parsed,
    )
}

async fn is_immune_author(
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &crate::config::schema::ContentFilterConfig,
) -> bool {
    let _ = ctx;
    if config.immune_roles.is_empty() {
        return false;
    }

    let Some(member) = message.member.as_ref() else {
        return false;
    };

    for role_id_str in &config.immune_roles {
        if let Ok(role_id) = role_id_str.parse::<u64>() {
            if member.roles.contains(&serenity::RoleId::new(role_id)) {
                return true;
            }
        }
    }

    false
}

async fn send_priority_user_warning(
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &crate::config::schema::ContentFilterConfig,
) {
    let Some(webhook_url) = &config.webhook_url else { return };

    let embed = serenity::CreateEmbed::new()
        .color(0x23272a) // Colors.NotQuiteBlack
        .author(serenity::CreateEmbedAuthor::new("Heuristic Scan - User Prioritized"))
        .description(format!(
            "<@{0}> (`{0}`) has crossed the priority threshold and will be sampled more aggressively.",
            message.author.id
        ))
        .timestamp(serenity::Timestamp::now());

    if let Ok(webhook) = serenity::Webhook::from_url(ctx, webhook_url).await {
        let _ = webhook.execute(ctx, false, serenity::ExecuteWebhook::new().embed(embed)).await;
    }
}

async fn send_scan_rate_change_log(
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &crate::config::schema::ContentFilterConfig,
    new_rate: f64,
) {
    let Some(webhook_url) = &config.webhook_url else { return };

    let rate = new_rate.round() as u64;
    let embed = serenity::CreateEmbed::new()
        .color(0xFAA61A)
        .author(serenity::CreateEmbedAuthor::new("Heuristic Scan: Scan Rate Update"))
        .description(format!(
            "Scan rate for <#{}> is now {} message{} per minute.",
            message.channel_id,
            rate,
            if rate == 1 { "" } else { "s" }
        ))
        .timestamp(serenity::Timestamp::now());

    if let Ok(webhook) = serenity::Webhook::from_url(ctx, webhook_url).await {
        let _ = webhook.execute(ctx, false, serenity::ExecuteWebhook::new().embed(embed)).await;
    }
}
