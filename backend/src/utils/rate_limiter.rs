use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::Mutex;

#[allow(dead_code)]
const MAX_RATE_LIMITER_ENTRIES: usize = 100;

/// A rate limiter that allows a maximum number of operations within a time window.
///
pub struct RateLimiter {
    /// Maximum operations allowed within the window.
    max: u32,
    /// Time window in milliseconds.
    window_ms: u64,
    /// Map of key -> (count, window_start).
    state: Mutex<HashMap<String, (u32, Instant)>>,
}

/// Result of a rate limit check.
pub struct RateLimitResult {
    pub success: bool,
    #[allow(dead_code)]
    pub remaining: u32,
    #[allow(dead_code)]
    pub reset: u64,
}

impl RateLimiter {
    /// Creates a new rate limiter.
    ///
    /// # Arguments
    /// * `max` - Maximum number of operations allowed within the window.
    /// * `window_ms` - The time window in milliseconds.
    pub fn new(max: u32, window_ms: u64) -> Self {
        Self {
            max,
            window_ms,
            state: Mutex::new(HashMap::new()),
        }
    }

    /// Attempts to consume one operation for the given key.
    pub async fn limit(&self, key: &str) -> RateLimitResult {
        let mut state = self.state.lock().await;
        let now = Instant::now();

        let entry = state.entry(key.to_string()).or_insert((0, now));

        if now.duration_since(entry.1).as_millis() as u64 >= self.window_ms {
            entry.0 = 1;
            entry.1 = now;
            return RateLimitResult {
                success: true,
                remaining: self.max.saturating_sub(1),
                reset: self.reset_at(now),
            };
        }

        if entry.0 >= self.max {
            return RateLimitResult {
                success: false,
                remaining: 0,
                reset: self.reset_at(entry.1),
            };
        }

        entry.0 += 1;

        RateLimitResult {
            success: true,
            remaining: self.max.saturating_sub(entry.0),
            reset: self.reset_at(entry.1),
        }
    }

    /// Checks whether the key is currently rate limited without consuming a request.
    #[allow(dead_code)]
    pub async fn check(&self, key: &str) -> RateLimitResult {
        let state = self.state.lock().await;
        let now = Instant::now();

        let Some(entry) = state.get(key) else {
            return RateLimitResult {
                success: true,
                remaining: self.max,
                reset: self.reset_at(now),
            };
        };

        if now.duration_since(entry.1).as_millis() as u64 >= self.window_ms {
            return RateLimitResult {
                success: true,
                remaining: self.max,
                reset: self.reset_at(now),
            };
        }

        RateLimitResult {
            success: entry.0 < self.max,
            remaining: self.max.saturating_sub(entry.0),
            reset: self.reset_at(entry.1),
        }
    }

    /// Resets the bucket for a key.
    #[allow(dead_code)]
    pub async fn reset(&self, key: &str) {
        self.state.lock().await.remove(key);
    }

    /// Clears all buckets.
    #[allow(dead_code)]
    pub async fn clear(&self) {
        self.state.lock().await.clear();
    }

    /// Cleanup expired entries and cap the cache size, matching the TS limiter.
    #[allow(dead_code)]
    pub async fn prune(&self) {
        let mut state = self.state.lock().await;
        let now = Instant::now();

        state.retain(|_, (_, start)| {
            (now.duration_since(*start).as_millis() as u64) < self.window_ms
        });

        if state.len() > MAX_RATE_LIMITER_ENTRIES {
            let mut entries: Vec<_> = state
                .iter()
                .map(|(key, (_, start))| (key.clone(), *start))
                .collect();
            entries.sort_by_key(|(_, start)| *start);

            for (key, _) in entries
                .into_iter()
                .take(state.len().saturating_sub(MAX_RATE_LIMITER_ENTRIES))
            {
                state.remove(&key);
            }
        }
    }

    /// Backwards-compatible alias for existing Rust call sites.
    #[allow(dead_code)]
    pub async fn cleanup(&self) {
        self.prune().await;
    }

    fn reset_at(&self, start: Instant) -> u64 {
        start.elapsed()
            .as_millis()
            .try_into()
            .ok()
            .and_then(|elapsed: u64| self.window_ms.checked_sub(elapsed))
            .unwrap_or(0)
    }
}
