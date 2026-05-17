/// Default message content when a message has no content.
pub const EMPTY_MESSAGE_CONTENT: &str = "Unknown message content.";

/// Content filter heuristic constants.
pub mod cf {
    pub const HEURISTIC_LOGGING_SMOOTH_ALPHA: f64 = 0.25;
    pub const HEURISTIC_WINDOW_SIZE: usize = 30;
    pub const MESSAGE_QUEUE_TIME_RANGE: u64 = 5000;
    pub const MESSAGE_DISTANCE_THRESHOLD: usize = 2;
    pub const MESSAGE_PACE_INCREASE_THRESHOLD: usize = 5;

    pub const HEURISTIC_MEDIUM_SCORE: f64 = 0.7;
    pub const HEURISTIC_LENIENT_SCORE: f64 = 0.8;
    pub const HEURISTIC_STRICT_SCORE: f64 = 0.6;

    pub const HEURISTIC_BASE_RISK: f64 = 0.05;
    pub const HEURISTIC_LENIENT_RISK_INCREASE: f64 = 0.3;
    pub const HEURISTIC_MEDIUM_RISK_INCREASE: f64 = 0.4;
    pub const HEURISTIC_STRICT_RISK_INCREASE: f64 = 0.5;

    pub const HEURISTIC_BASE_SCAN_RATE: u32 = 10;
    pub const HEURISTIC_MAX_SCAN_RATE: u32 = 60;
    pub const HEURISTIC_MIN_SCAN_RATE: u32 = 1;
    pub const HEURISTIC_SCAN_WINDOW: u64 = 60 * 1000;

    pub const HEURISTIC_RATE_INCREASE_STEP: u32 = 10;
    pub const HEURISTIC_RATE_INCREASE_DURATION: u64 = 5 * 60 * 1000;
    pub const HEURISTIC_RATE_CHANGE_INTERVAL: u64 = 10 * 60 * 1000;

    pub const HEURISTIC_SCORE_THRESHOLD: u32 = 7;
    pub const HEURISTIC_SMOOTHED_FP_ALPHA: f64 = 0.1;
    pub const HEURISTIC_MIN_SAMPLING_FACTOR: f64 = 0.01;

    pub const HEURISTIC_SCORE_FP_INFLUENCE: f64 = 0.15;
    pub const HEURISTIC_USER_RECENT_ALERT_WINDOW_MS: u64 = 5 * 60 * 1000;
    pub const HEURISTIC_SCORE_USER_ALERT_INFLUENCE: f64 = 0.12;

    pub const DEFAULT_STANDARD_MESSAGE_SCORE: u32 = 1;
    pub const DEFAULT_REPLY_MESSAGE_SCORE: u32 = 1;

    pub const CONTENT_FILTER_ALERT_TTL: u64 = 24 * 60 * 60 * 1000;
    #[allow(dead_code)]
    pub const CONTENT_FILTER_LOG_TTL: u64 = 7 * 24 * 60 * 60 * 1000;

    // Heuristic scanner additional constants
    pub const HEURISTIC_REACTION_MAX_LENGTH: usize = 40;
    pub const HEURISTIC_REACTION_MAX_WORDS: usize = 6;
    pub const HEURISTIC_MATCH_MAX_LENGTH: usize = 48;
    pub const HEURISTIC_MATCH_MAX_WORDS: usize = 8;
    pub const HEURISTIC_MIN_SIGNAL_SCORE: usize = 4;
    pub const HEURISTIC_MIN_CANDIDATES: usize = 2;
    pub const HEURISTIC_MAX_CANDIDATES_PER_SCAN: usize = 3;
    pub const HEURISTIC_CANDIDATE_TRAFFIC_DIVISOR: usize = 10;
    pub const HEURISTIC_DYNAMIC_WINDOW_MULT_MAX: f64 = 4.0;
    pub const HEURISTIC_DYNAMIC_WINDOW_MIN: usize = 10;
    pub const HEURISTIC_SCAN_DEBOUNCE_MIN: u64 = 10_000;
    pub const HEURISTIC_SCAN_DEBOUNCE_MAX: u64 = 60_000;
    pub const HEURISTIC_SCAN_DEBOUNCE_MIN_DELAY: u64 = 10_000;
    pub const HEURISTIC_CHANNEL_SCAN_COOLDOWN_MS: u64 = 90_000;
    pub const HEURISTIC_EWMA_MPM_ALPHA: f64 = 0.15;
    pub const HEURISTIC_PRIORITY_USER_FLAG_THRESHOLD: u32 = 2;

    // Beta distribution constants
    pub const HEURISTIC_MAX_BETA_INCREMENT_PER_CALL: f64 = 5.0;
    pub const HEURISTIC_BETA_MEAN_MIN: f64 = 0.01;
    pub const HEURISTIC_BETA_MEAN_MAX: f64 = 0.99;
    pub const HEURISTIC_BETA_DECAY_HALF_LIFE_MS: u64 = 3 * 60 * 60 * 1000; // 3 hours

    // PID controller constants
    pub const HEURISTIC_PID_BASE_KP: f64 = 2.0;
    pub const HEURISTIC_PID_BASE_KI: f64 = 0.08;
    pub const HEURISTIC_PID_BASE_KD: f64 = 0.8;
    pub const HEURISTIC_PID_KP_MIN: f64 = 0.5;
    pub const HEURISTIC_PID_KP_MAX: f64 = 10.0;
    pub const HEURISTIC_PID_KI_MIN: f64 = 0.001;
    pub const HEURISTIC_PID_KI_MAX: f64 = 1.0;
    pub const HEURISTIC_PID_KD_MIN: f64 = 0.01;
    pub const HEURISTIC_PID_KD_MAX: f64 = 5.0;

    // Traffic and confidence weighting
    pub const HEURISTIC_K_TRAFFIC: f64 = 0.6;
    pub const HEURISTIC_K_CONF: f64 = 0.4;

    // Decay constants
    pub const HEURISTIC_DECAY_BASE: f64 = 0.92;
    pub const HEURISTIC_DECAY_FP_INFLUENCE_FACTOR: f64 = 0.5;
    pub const HEURISTIC_DECAY_FP_INFLUENCE_MAX: f64 = 0.35;
    pub const HEURISTIC_DECAY_ALERT_INFLUENCE_PER_ALERT: f64 = 0.02;
    pub const HEURISTIC_DECAY_ALERT_INFLUENCE_MAX: f64 = 0.2;
    pub const HEURISTIC_DECAY_MIN: f64 = 0.55;
    pub const HEURISTIC_DECAY_MAX: f64 = 0.98;

    // Priority user constants
    pub const HEURISTIC_PRIORITY_MULT_FACTOR: f64 = 3.0;
    pub const HEURISTIC_PRIORITY_MULT_MAX: f64 = 2.0;
    pub const HEURISTIC_RECENT_ALERTS_CAP: f64 = 50.0;

    // Dynamic weight for user scoring
    pub const HEURISTIC_DYNAMIC_WEIGHT_BASE: f64 = 0.6;
    pub const HEURISTIC_DYNAMIC_WEIGHT_SEVERITY_MULT: f64 = 1.2;
    pub const HEURISTIC_DYNAMIC_WEIGHT_MIN: f64 = 0.5;
    pub const HEURISTIC_DYNAMIC_WEIGHT_MAX: f64 = 5.0;

    // Scheduling constants
    pub const HEURISTIC_RISK_MULTIPLIER_MIN: f64 = 0.2;
    pub const HEURISTIC_RISK_MULTIPLIER_MAX: f64 = 1.0;
    pub const HEURISTIC_JITTER_PCT: f64 = 0.1;
    pub const HEURISTIC_MIN_SCHEDULE_DELAY: u64 = 100;

    // Adaptive threshold constants
    pub const HEURISTIC_ADAPTIVE_P95_WINDOWS: usize = 10;
    pub const HEURISTIC_ADAPTIVE_DECAY_ALPHA: f64 = 0.6;
    pub const HEURISTIC_TICK_INTERVAL_MS: u64 = 100;

    // Window constants for state management
    pub const HEURISTIC_WINDOW_BASE_MS: u64 = 120_000;
    pub const HEURISTIC_WINDOW_MIN_MS: u64 = 30_000;
    pub const HEURISTIC_WINDOW_MAX_MS: u64 = 300_000;

    // Score pruning
    pub const HEURISTIC_SCORE_PRUNE_EPSILON: f64 = 0.1;
    pub const HEURISTIC_USER_SCORES_MAX_SIZE: usize = 1000;

    // Rate decay
    pub const HEURISTIC_RATE_DECAY_A: f64 = 0.6;
    pub const HEURISTIC_RATE_DECAY_B: f64 = 0.4;
    pub const HEURISTIC_MIN_ABS_CHANGE_FOR_LOG: f64 = 10.0;

    // Automated scanner constants
    pub const AUTOMATED_MAX_CONCURRENT_JOBS: usize = 4;
    pub const AUTOMATED_RETRY_BASE_DELAY_MS: u64 = 8_000;
    pub const AUTOMATED_RETRY_MAX_DELAY_MS: u64 = 5 * 60 * 1000;
    pub const AUTOMATED_LOW_PRIORITY_DROP_QUEUE_SIZE: usize = 500;
    pub const AUTOMATED_LOW_PRIORITY_DROP_RISK_THRESHOLD: f64 = 0.4;
    pub const AUTOMATED_LOW_PRIORITY_DROP_LOG_WINDOW_MS: u64 = 30_000;
    pub const AUTOMATED_MAX_GUILD_QUEUE_DEPTH: usize = 50;
    pub const AUTOMATED_CLEANUP_INTERVAL_MS: u64 = 5 * 60 * 1000;
    pub const AUTOMATED_METRICS_LOG_INTERVAL_MS: u64 = 60_000;
    pub const AUTOMATED_HEARTBEAT_FORCED_LOG_INTERVAL_MS: u64 = 10 * 60 * 1000;
    pub const AUTOMATED_MESSAGE_CACHE_MAX_AGE_MS: u64 = 10 * 60 * 1000;
    pub const AUTOMATED_MESSAGE_CACHE_MAX_SIZE: usize = 12_000;
    pub const AUTOMATED_OPENAI_RATE_LIMIT_MIN_RETRY_MS: u64 = 15_000;
    pub const AUTOMATED_OPENAI_RATE_LIMIT_MIN_RETRY_MS_FORCED: u64 = 5_000;
    pub const AUTOMATED_FORCE_COOLDOWN_BYPASS_WINDOW_MS: u64 = 5_000;
    pub const AUTOMATED_DEFAULT_TRAFFIC_ESTIMATE: f64 = 60.0;
}
