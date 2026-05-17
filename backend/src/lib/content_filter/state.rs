//! Per-channel scan state storage.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use super::types::ChannelScanState;
use crate::utils::constants::cf;

const MAX_CHANNEL_STATES: usize = 150;
const CHANNEL_STATE_TTL_MS: u64 = 60 * 60 * 1000;

static STATES: Mutex<Option<HashMap<String, ChannelScanState>>> = Mutex::new(None);
static ACTIVITY: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
static SMOOTHED_FP: Mutex<Option<HashMap<String, f64>>> = Mutex::new(None);

fn recover_lock<T>(mutex: &'static Mutex<T>) -> MutexGuard<'static, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn with_states<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, ChannelScanState>, &mut HashMap<String, u64>) -> R,
{
    let mut states_guard = recover_lock(&STATES);
    let mut activity_guard = recover_lock(&ACTIVITY);

    let states = states_guard.get_or_insert_with(HashMap::new);
    let activity = activity_guard.get_or_insert_with(HashMap::new);

    f(states, activity)
}

fn with_smoothed_fp<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, f64>) -> R,
{
    let mut guard = recover_lock(&SMOOTHED_FP);
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

/// Gets or creates channel scan state.
pub fn get_or_init(channel_id: &str, guild_id: Option<&str>) -> ChannelScanState {
    let now = now_ms();
    // Returns (state, evicted_ids_from_capacity_enforcement).
    let (state, evicted) = {
        let mut states_guard = recover_lock(&STATES);
        let mut activity_guard = recover_lock(&ACTIVITY);
        let states = states_guard.get_or_insert_with(HashMap::new);
        let activity = activity_guard.get_or_insert_with(HashMap::new);

        activity.insert(channel_id.to_string(), now);

        if let Some(state) = states.get_mut(channel_id) {
            state.last_activity = now;
            if let Some(gid) = guild_id {
                state.guild_id = Some(gid.to_string());
            }
            return state.clone();
        }

        let state = ChannelScanState::new(channel_id.to_string(), guild_id.map(str::to_string));
        states.insert(channel_id.to_string(), state.clone());
        let evicted = enforce_capacity_collecting(states, activity);
        (state, evicted)
    };

    // Mirror TS StateStore._enforceCapacity() which also clears _smoothedFalsePositive.
    if !evicted.is_empty() {
        with_smoothed_fp(|fp| {
            for id in &evicted {
                fp.remove(id);
            }
        });
    }

    state
}

/// Gets state for a channel if it exists.
pub fn get(channel_id: &str) -> Option<ChannelScanState> {
    let now = now_ms();
    with_states(|states, activity| {
        let state = states.get_mut(channel_id)?;
        state.last_activity = now;
        activity.insert(channel_id.to_string(), now);
        Some(state.clone())
    })
}

/// Updates state for a channel.
pub fn update<F>(channel_id: &str, guild_id: Option<&str>, f: F)
where
    F: FnOnce(&mut ChannelScanState),
{
    let now = now_ms();
    with_states(|states, activity| {
        activity.insert(channel_id.to_string(), now);
        let state = states.entry(channel_id.to_string()).or_insert_with(|| {
            ChannelScanState::new(channel_id.to_string(), guild_id.map(str::to_string))
        });
        state.last_activity = now;
        f(state);
    });
}

/// Updates message EWMA for a channel (called on each incoming message).
#[allow(dead_code)]
pub fn record_message(channel_id: &str, guild_id: Option<&str>) {
    let now = now_ms();
    update(channel_id, guild_id, |state| {
        state.message_timestamps.push(now);
        // Keep only last scan window of timestamps.
        let cutoff = now.saturating_sub(cf::HEURISTIC_SCAN_WINDOW);
        state.message_timestamps.retain(|&ts| ts >= cutoff);

        // Compute messages per minute over the last scan window.
        let mpm = state.message_timestamps.len() as f64;

        // EWMA update.
        let alpha = cf::HEURISTIC_EWMA_MPM_ALPHA;
        state.ewma_mpm = alpha * mpm + (1.0 - alpha) * state.ewma_mpm;
    });
}

/// Gets smoothed false-positive ratio for a channel.
pub fn get_smoothed_false_positive(channel_id: &str) -> f64 {
    with_smoothed_fp(|map| *map.get(channel_id).unwrap_or(&0.0))
}

/// Sets smoothed false-positive ratio for a channel.
pub fn set_smoothed_false_positive(channel_id: &str, value: f64) {
    with_smoothed_fp(|map| {
        map.insert(channel_id.to_string(), value);
    });
}

/// Computes a global scan-rate estimate across channels.
pub fn aggregate_scan_rate_estimate<F>(mut rate_resolver: F) -> f64
where
    F: FnMut(&ChannelScanState) -> f64,
{
    with_states(|states, _| {
        if states.is_empty() {
            return cf::HEURISTIC_BASE_SCAN_RATE as f64;
        }

        let mut total = 0.0f64;
        let mut count = 0.0f64;
        for state in states.values() {
            total += rate_resolver(state);
            count += 1.0;
        }

        (total / count.max(1.0)).max(cf::HEURISTIC_BASE_SCAN_RATE as f64)
    })
}

/// Prunes stale channel state entries.
pub fn prune() {
    let now = now_ms();
    let cutoff = now.saturating_sub(CHANNEL_STATE_TTL_MS);

    // Collect pruned channel IDs so we can also remove them from SMOOTHED_FP.
    let mut pruned: Vec<String> = Vec::new();
    let mut evicted: Vec<String> = Vec::new();

    with_states(|states, activity| {
        activity.retain(|channel_id, &mut last_activity| {
            if last_activity < cutoff {
                states.remove(channel_id);
                pruned.push(channel_id.clone());
                false
            } else {
                true
            }
        });
        // enforce_capacity returns the list of evicted channel IDs.
        evicted = enforce_capacity_collecting(states, activity);
    });

    // Mirror TS StateStore.prune() which also clears _smoothedFalsePositive.
    if !pruned.is_empty() || !evicted.is_empty() {
        with_smoothed_fp(|fp| {
            for id in pruned.iter().chain(evicted.iter()) {
                fp.remove(id);
            }
        });
    }
}

/// Returns the number of tracked channels.
pub fn count() -> usize {
    with_states(|states, _| states.len())
}

/// Returns a snapshot of all tracked channel states.
pub fn list() -> Vec<ChannelScanState> {
    with_states(|states, _| states.values().cloned().collect())
}

/// Enforces capacity and returns the list of evicted channel IDs.
fn enforce_capacity_collecting(
    states: &mut HashMap<String, ChannelScanState>,
    activity: &mut HashMap<String, u64>,
) -> Vec<String> {
    if states.len() <= MAX_CHANNEL_STATES {
        return Vec::new();
    }

    let mut by_least_recent: Vec<(String, u64)> =
        activity.iter().map(|(k, &v)| (k.clone(), v)).collect();
    by_least_recent.sort_by_key(|&(_, ts)| ts);

    let excess = states.len() - MAX_CHANNEL_STATES;
    let mut evicted = Vec::with_capacity(excess);
    for (channel_id, _) in by_least_recent.iter().take(excess) {
        states.remove(channel_id);
        activity.remove(channel_id);
        evicted.push(channel_id.clone());
    }
    evicted
}
