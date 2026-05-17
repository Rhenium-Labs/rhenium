//! Heuristic scanner for content filter.
//! Detects suspicious message patterns (reaction-like, near-duplicates, pace increase).

use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, MutexGuard,
};
use tracing::error;

use crate::utils::constants::cf;
/// State for debounce timers per channel.
static SCAN_TIMERS: Mutex<Option<HashMap<String, tokio::task::JoinHandle<()>>>> = Mutex::new(None);
static LAST_SCAN_TIMESTAMPS: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
static CLEANUP_STARTED: AtomicBool = AtomicBool::new(false);

const MAX_TIMER_CHANNELS: usize = 150;
const TIMESTAMP_TTL_MS: u64 = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// Lightweight diagnostics for heuristic scanner state.
pub struct HeuristicDiagnostics {
    pub timers: usize,
    pub tracked_channels: usize,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn recover_lock<T>(mutex: &'static Mutex<T>) -> MutexGuard<'static, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Returns timer and channel counters for debug output.
pub fn diagnostics() -> HeuristicDiagnostics {
    let timers = SCAN_TIMERS
        .lock()
        .ok()
        .and_then(|map| map.as_ref().map(|m| m.len()))
        .unwrap_or(0);

    let tracked_channels = LAST_SCAN_TIMESTAMPS
        .lock()
        .ok()
        .and_then(|map| map.as_ref().map(|m| m.len()))
        .unwrap_or(0);

    HeuristicDiagnostics {
        timers,
        tracked_channels,
    }
}

/// Starts periodic cleanup for stale timer and timestamp entries.
pub fn start_cleanup_interval() {
    if CLEANUP_STARTED.swap(true, Ordering::Relaxed) {
        return;
    }

    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(CLEANUP_INTERVAL_MS)).await;
            prune_stale_entries();
        }
    });
}

fn prune_stale_entries() {
    let now = now_ms();
    let cutoff = now.saturating_sub(TIMESTAMP_TTL_MS);

    let mut timers_guard = recover_lock(&SCAN_TIMERS);
    let mut last_guard = recover_lock(&LAST_SCAN_TIMESTAMPS);

    let timers = timers_guard.get_or_insert_with(HashMap::new);
    let last = last_guard.get_or_insert_with(HashMap::new);

    // TS only prunes stale last-scan timestamps here. Pending timers are preserved unless
    // capacity enforcement removes their channel.
    let stale_ids: Vec<String> = last
        .iter()
        .filter(|(_, ts)| **ts < cutoff)
        .map(|(id, _)| id.clone())
        .collect();

    for id in stale_ids {
        last.remove(&id);
    }

    // Enforce max channels by removing least recent.
    if last.len() > MAX_TIMER_CHANNELS {
        let mut by_least_recent: Vec<(String, u64)> = last.iter().map(|(k, &v)| (k.clone(), v)).collect();
        by_least_recent.sort_by_key(|&(_, ts)| ts);
        let excess = last.len() - MAX_TIMER_CHANNELS;
        for (id, _) in by_least_recent.into_iter().take(excess) {
            last.remove(&id);
            if let Some(handle) = timers.remove(&id) {
                handle.abort();
            }
        }
    }
}

/// Triggers a debounced heuristic scan for a channel.
pub async fn trigger_scan(
    message: &poise::serenity_prelude::Message,
    guild_config: &crate::lib::config::guild::GuildConfig,
    data: crate::Data,
    ctx: poise::serenity_prelude::Context,
) {
    let config = match guild_config.parse_content_filter_config() {
        Some(c) => c.config,
        None => return,
    };

    if !config.use_heuristic_scanner {
        return;
    }

    let channel_id = message.channel_id.to_string();
    let guild_id = message.guild_id.map(|id| id.to_string()).unwrap_or_default();

    if !config.channel_scoping.is_empty() {
        let Some(guild_channel) = message
            .channel_id
            .to_channel(&ctx)
            .await
            .ok()
            .and_then(|c| c.guild())
        else {
            return;
        };

        let is_thread = matches!(
            guild_channel.kind,
            poise::serenity_prelude::ChannelType::PublicThread
                | poise::serenity_prelude::ChannelType::PrivateThread
                | poise::serenity_prelude::ChannelType::NewsThread
        );

        let (scope_channel_id, thread_id, category_id) = if is_thread {
            let thread_id = Some(guild_channel.id.to_string());
            match guild_channel.parent_id {
                Some(parent_channel_id) => {
                    let category_id = parent_channel_id
                        .to_channel(&ctx)
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
                .filter(|s| s.scoping_type == crate::lib::config::schema::ChannelScopingType::Include)
                .map(|s| s.channel_id.clone())
                .collect(),
            excluded: config
                .channel_scoping
                .iter()
                .filter(|s| s.scoping_type == crate::lib::config::schema::ChannelScopingType::Exclude)
                .map(|s| s.channel_id.clone())
                .collect(),
        };

        if !crate::utils::channel_in_scope_resolved(
            &scope_channel_id,
            thread_id.as_deref(),
            category_id.as_deref(),
            &parsed,
        ) {
            return;
        }
    }
    // Always init state for the channel (mirrors TS getOrInitChannelState called before timer check).
    let state = super::state::get_or_init(&channel_id, Some(&guild_id));
    let ewma_mpm = state.ewma_mpm;
    let chat_rate = ewma_mpm.max(1.0).round() as u64;

    let now = now_ms();

    let last_scan = get_last_scan(&channel_id);
    let time_since = now.saturating_sub(last_scan);
    let hard_cooldown = cf::HEURISTIC_CHANNEL_SCAN_COOLDOWN_MS;

    // Check if we already have a pending timer for this channel.
    {
        let mut timers = recover_lock(&SCAN_TIMERS);
        let timers = timers.get_or_insert_with(HashMap::new);
        if timers.contains_key(&channel_id) {
            return;
        }
    }

    let debounce = calc_debounce(chat_rate);
    let mut delay = debounce;

    if time_since < debounce {
        delay = debounce - time_since;
    }
    if time_since < hard_cooldown {
        delay = delay.max(hard_cooldown - time_since);
    }

    // Spawn debounced task.
    let channel_id_clone = channel_id.clone();
    let guild_id_clone = guild_id.clone();
    let handle = tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;

        set_last_scan(&channel_id_clone, now_ms());
        remove_timer(&channel_id_clone);

        if let Err(e) = execute_scan(&channel_id_clone, &guild_id_clone, &data, &ctx, &config).await {
            error!("CF heuristic scan failed for channel {}: {e}", channel_id_clone);
        }
    });

    let mut timers = recover_lock(&SCAN_TIMERS);
    let timers = timers.get_or_insert_with(HashMap::new);
    timers.insert(channel_id, handle);
}

fn calc_debounce(chat_rate: u64) -> u64 {
    let min = cf::HEURISTIC_SCAN_DEBOUNCE_MIN as f64;
    let max = cf::HEURISTIC_SCAN_DEBOUNCE_MAX as f64;
    let capped = chat_rate.min(20) as f64;
    let debounce = (min + (capped / 20.0) * (max - min)).floor() as u64;
    debounce.max(cf::HEURISTIC_SCAN_DEBOUNCE_MIN_DELAY)
}

fn get_last_scan(channel_id: &str) -> u64 {
    recover_lock(&LAST_SCAN_TIMESTAMPS)
        .get_or_insert_with(HashMap::new)
        .get(channel_id)
        .copied()
        .unwrap_or(0)
}

fn set_last_scan(channel_id: &str, ts: u64) {
    recover_lock(&LAST_SCAN_TIMESTAMPS)
        .get_or_insert_with(HashMap::new)
        .insert(channel_id.to_string(), ts);
}

fn remove_timer(channel_id: &str) {
    if let Some(timers) = recover_lock(&SCAN_TIMERS).as_mut() {
        timers.remove(channel_id);
    }
}

/// Executes the heuristic scan for a channel.
async fn execute_scan(
    channel_id: &str,
    guild_id: &str,
    data: &crate::Data,
    ctx: &poise::serenity_prelude::Context,
    config: &crate::lib::config::schema::ContentFilterConfig,
) -> Result<(), String> {
    use super::automated;

    if !config.enabled || config.webhook_url.is_none() {
        return Ok(());
    }

    let state = super::state::get_or_init(channel_id, Some(guild_id));
    let now = now_ms();
    super::state::update(channel_id, Some(guild_id), |s| s.scan_timestamps.push(now));

    let traffic = state.ewma_mpm.max(1.0).round() as u64;
    let multiplier = ((traffic as f64) / (cf::HEURISTIC_BASE_SCAN_RATE as f64).max(1.0))
        .min(cf::HEURISTIC_DYNAMIC_WINDOW_MULT_MAX);
    let dynamic_window = ((cf::HEURISTIC_WINDOW_SIZE as f64 * multiplier).round() as usize)
        .max(cf::HEURISTIC_DYNAMIC_WINDOW_MIN);
    let window_size = dynamic_window
        .min(cf::HEURISTIC_WINDOW_SIZE * cf::HEURISTIC_DYNAMIC_WINDOW_MULT_MAX as usize);

    let messages = data
        .message_manager
        .get_for_channel(&data.db, channel_id, window_size)
        .await;
    if messages.is_empty() {
        return Ok(());
    }

    let chat_rate_increased = calculate_chat_rate_increase(&messages);
    let reaction_messages = find_reaction_messages(&messages);
    let matching_messages = find_matching_messages(&messages);

    if reaction_messages.is_empty() && matching_messages.is_empty() {
        return Ok(());
    }

    let signal_score = reaction_messages.len() * 2 + matching_messages.len();
    if signal_score < cf::HEURISTIC_MIN_SIGNAL_SCORE {
        return Ok(());
    }

    let dynamic_threshold = compute_dynamic_threshold(state.scan_rate, state.ewma_mpm);
    let traffic = traffic as usize;

    let heuristic = calculate_heuristics(
        &reaction_messages,
        &matching_messages,
        chat_rate_increased,
        data,
    )
    .await;

    let candidates = collect_candidate_messages(
        &messages,
        &heuristic,
        dynamic_threshold,
        traffic,
        &reaction_messages,
        &matching_messages,
    );
    if candidates.is_empty() {
        return Ok(());
    }

    let mut queued = 0usize;
    let signals = build_heuristic_signals(
        reaction_messages.len(),
        matching_messages.len(),
        chat_rate_increased,
    );
    let risk = estimate_heuristic_risk(signals.len(), dynamic_threshold);

    let channel_id_u64 = channel_id.parse::<u64>().unwrap_or(0);
    let channel = poise::serenity_prelude::ChannelId::new(channel_id_u64);

    for message_id in candidates {
        let msg = match messages.iter().find(|m| m.id == message_id) {
            Some(m) => m,
            None => continue,
        };

        let actual_message = if let Some(cached) = automated::get_cached_message(&msg.id) {
            Some(cached)
        } else {
            let message_id = msg.id.parse::<u64>().unwrap_or(0);
            channel
                .message(ctx, poise::serenity_prelude::MessageId::new(message_id))
                .await
                .ok()
        };

        if let Some(actual_message) = actual_message {
            if actual_message.guild_id.is_none() {
                continue;
            }
            if !config.immune_roles.is_empty() {
                let is_immune = actual_message
                    .member
                    .as_ref()
                    .map(|member| {
                        config.immune_roles.iter().any(|rid| {
                            rid.parse::<u64>()
                                .ok()
                                .map(|id| {
                                    member.roles.contains(&poise::serenity_prelude::RoleId::new(id))
                                })
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false);
                if is_immune {
                    continue;
                }
            }
            automated::enqueue_heuristic_candidate(ctx, &actual_message, config, signals.clone(), risk).await;
            queued += 1;
        }
    }

    if queued > 0 {
        tracing::info!(
            channel_id = channel_id,
            queued = queued,
            signal_score = signal_score,
            "CF heuristic candidates queued"
        );
    }

    Ok(())
}

fn compute_dynamic_threshold(scan_rate: f64, ewma_mpm: f64) -> f64 {
    // TS: const traffic = Math.max(1, Math.round(ewmaMpm))
    let traffic = ewma_mpm.round().max(1.0);
    let ratio = traffic / scan_rate.max(1.0);
    (cf::HEURISTIC_SCORE_THRESHOLD as f64 * ratio.sqrt()).max(1.0).round()
}

#[derive(Clone)]
struct ReferenceHeuristic {
    message_id: String,
    score: u32,
}

#[derive(Clone)]
struct HeuristicAggregate {
    standard_score: u32,
    reference_data: Vec<ReferenceHeuristic>,
}

async fn calculate_heuristics(
    reaction_messages: &[&crate::lib::repository::messages::SerializedMessage],
    matching_messages: &[&crate::lib::repository::messages::SerializedMessage],
    chat_rate_increased: bool,
    data: &crate::Data,
) -> HeuristicAggregate {
    let mut reference_scores: HashMap<String, u32> = HashMap::new();
    let mut standard_score = cf::DEFAULT_STANDARD_MESSAGE_SCORE;

    for message in reaction_messages
        .iter()
        .copied()
        .chain(matching_messages.iter().copied())
    {
        if let Some(reference_id) = &message.reference_id {
            if let Some(score) = reference_scores.get_mut(reference_id) {
                *score += 1;
            } else if data
                .message_manager
                .get(&data.db, reference_id)
                .await
                .is_some()
            {
                reference_scores.insert(reference_id.clone(), cf::DEFAULT_REPLY_MESSAGE_SCORE);
            }
        } else {
            standard_score += 1;
        }
    }

    let has_strong_signal = reaction_messages.len() >= 2 || matching_messages.len() >= 2;
    if chat_rate_increased && has_strong_signal {
        standard_score += 1;
        for score in reference_scores.values_mut() {
            *score += 1;
        }
    }

    HeuristicAggregate {
        standard_score,
        reference_data: reference_scores
            .into_iter()
            .map(|(message_id, score)| ReferenceHeuristic { message_id, score })
            .collect(),
    }
}

fn collect_candidate_messages(
    serialized_messages: &[crate::lib::repository::messages::SerializedMessage],
    heuristic: &HeuristicAggregate,
    dynamic_threshold: f64,
    traffic: usize,
    reaction_messages: &[&crate::lib::repository::messages::SerializedMessage],
    matching_messages: &[&crate::lib::repository::messages::SerializedMessage],
) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut signal_ids: HashSet<String> = HashSet::new();
    signal_ids.extend(reaction_messages.iter().map(|m| m.id.clone()));
    signal_ids.extend(matching_messages.iter().map(|m| m.id.clone()));

    if heuristic.standard_score as f64 >= dynamic_threshold && !signal_ids.is_empty() {
        // TS: Math.max(HEURISTIC_MIN_CANDIDATES, Math.round(traffic / DIVISOR))
        let count = ((traffic as f64 / cf::HEURISTIC_CANDIDATE_TRAFFIC_DIVISOR as f64).round() as usize)
            .max(cf::HEURISTIC_MIN_CANDIDATES);
        let candidate_limit = signal_ids
            .len()
            .min(count)
            .min(cf::HEURISTIC_MAX_CANDIDATES_PER_SCAN);

        for message in serialized_messages {
            if !signal_ids.contains(&message.id) {
                continue;
            }
            if seen.insert(message.id.clone()) {
                candidates.push(message.id.clone());
            }
            if candidates.len() >= candidate_limit {
                break;
            }
        }
    }

    for reference in &heuristic.reference_data {
        if reference.score as f64 >= dynamic_threshold && seen.insert(reference.message_id.clone()) {
            candidates.push(reference.message_id.clone());
        }
    }

    candidates
}

fn build_heuristic_signals(
    reaction_count: usize,
    matching_count: usize,
    chat_rate_increased: bool,
) -> Vec<String> {
    let mut signals = Vec::new();
    if reaction_count > 0 {
        signals.push(format!(
            "Heuristic: {} reaction-like messages detected",
            reaction_count
        ));
    }
    if matching_count > 0 {
        signals.push(format!(
            "Heuristic: {} near-duplicate messages detected",
            matching_count
        ));
    }
    if chat_rate_increased {
        signals.push("Heuristic: message pace increase detected".to_string());
    }

    signals
}

fn estimate_heuristic_risk(signal_count: usize, threshold: f64) -> f64 {
    let signal_boost = (signal_count as f64 * 0.12).min(0.35);
    let threshold_boost = (1.0 / threshold.max(1.0)).min(0.25);
    (0.6 + signal_boost + threshold_boost).min(1.0)
}

/// Detects if the recent message pace increased.
fn calculate_chat_rate_increase(messages: &[crate::lib::repository::messages::SerializedMessage]) -> bool {
    let now = now_ms();
    let recent_start = now.saturating_sub(cf::MESSAGE_QUEUE_TIME_RANGE);
    let previous_start = now.saturating_sub(cf::MESSAGE_QUEUE_TIME_RANGE * 2);

    let recent: Vec<_> = messages
        .iter()
        .filter(|m| m.created_at.timestamp_millis() as u64 >= recent_start)
        .collect();
    let previous: Vec<_> = messages
        .iter()
        .filter(|m| {
            let created_ms = m.created_at.timestamp_millis() as u64;
            created_ms >= previous_start && created_ms < recent_start
        })
        .collect();
    recent.len().saturating_sub(previous.len()) >= cf::MESSAGE_PACE_INCREASE_THRESHOLD
}

/// Finds reaction-like short messages.
fn find_reaction_messages(messages: &[crate::lib::repository::messages::SerializedMessage]) -> Vec<&crate::lib::repository::messages::SerializedMessage> {
    static REACTION_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?:^|\s)\p{Lu}{4,11}(?:$|\s)").expect("valid reaction regex")
    });
    static PUNCT_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"[!?]{2,}").expect("valid punctuation regex")
    });

    messages.iter().filter(|m| {
        let content_str = m.content.as_deref().unwrap_or("").trim().to_string();
        if content_str.is_empty() || content_str.chars().count() > cf::HEURISTIC_REACTION_MAX_LENGTH {
            return false;
        }
        let word_count = count_words(&content_str);
        if word_count > cf::HEURISTIC_REACTION_MAX_WORDS {
            return false;
        }

        REACTION_RE.is_match(&content_str) || PUNCT_RE.is_match(&content_str)
    }).collect()
}

/// Finds near-duplicate adjacent messages from different users.
fn find_matching_messages(messages: &[crate::lib::repository::messages::SerializedMessage]) -> Vec<&crate::lib::repository::messages::SerializedMessage> {
    let mut matching = Vec::new();
    for i in 0..messages.len().saturating_sub(1) {
        let current = &messages[i];
        let next = &messages[i + 1];

        if current.author_id == next.author_id {
            continue;
        }

        let cur_content = current.content.as_deref().unwrap_or("");
        let nxt_content = next.content.as_deref().unwrap_or("");

        if !is_heuristic_comparable_content(cur_content)
            || !is_heuristic_comparable_content(nxt_content)
        {
            continue;
        }

        let cur_lower = cur_content.to_lowercase();
        let nxt_lower = nxt_content.to_lowercase();
        let dist = levenshtein_distance(&cur_lower, &nxt_lower);
        let max_len = cur_lower.chars().count().max(nxt_lower.chars().count());
        let similarity = if max_len > 0 { 1.0 - dist as f64 / max_len as f64 } else { 0.0 };

        if similarity >= 0.9 || dist <= cf::MESSAGE_DISTANCE_THRESHOLD {
            matching.push(current);
        }
    }
    matching
}

fn is_heuristic_comparable_content(content: &str) -> bool {
    let normalized = content.trim();
    if normalized.is_empty() {
        return false;
    }
    if normalized.chars().count() > cf::HEURISTIC_MATCH_MAX_LENGTH {
        return false;
    }
    count_words(normalized) <= cf::HEURISTIC_MATCH_MAX_WORDS
}

fn count_words(content: &str) -> usize {
    content.split_whitespace().count()
}

/// Simple Levenshtein distance for near-duplicate detection.
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let (m, n) = (a_chars.len(), b_chars.len());

    let mut dp = vec![vec![0usize; n + 1]; m + 1];
    for (i, row) in dp.iter_mut().enumerate().take(m + 1) {
        row[0] = i;
    }
    for (j, cell) in dp[0].iter_mut().enumerate().take(n + 1) {
        *cell = j;
    }

    for i in 1..=m {
        for j in 1..=n {
            dp[i][j] = if a_chars[i - 1] == b_chars[j - 1] {
                dp[i - 1][j - 1]
            } else {
                1 + dp[i - 1][j].min(dp[i][j - 1]).min(dp[i - 1][j - 1])
            };
        }
    }
    dp[m][n]
}

/// Returns heuristic scanner diagnostics.
#[allow(dead_code)]
pub fn get_diagnostics() -> (usize, usize) {
    let timers = recover_lock(&SCAN_TIMERS)
        .as_ref()
        .map(|m| m.len())
        .unwrap_or(0);
    let tracked = recover_lock(&LAST_SCAN_TIMESTAMPS)
        .as_ref()
        .map(|m| m.len())
        .unwrap_or(0);
    (timers, tracked)
}
