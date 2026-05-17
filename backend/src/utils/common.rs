use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;

/// Shared HTTP client for hastebin uploads — built once, reused for every call.
static HASTEBIN_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(concat!("rhenium/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(10))
        .build()
        .expect("hastebin http client")
});

/// Truncate a string to a maximum length, appending an ellipsis and remaining character count.
///
/// - Returns as-is if within the limit.
/// - Otherwise crops to `max_len - 23` chars (which may be 0 or negative → empty crop)
///   and appends `…(N more characters)`.
pub fn truncate(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        return s.to_string();
    }

    // TS: croppedStr = str.slice(0, maxLength - 23)
    // When maxLength < 23, slice(0, negative) returns "".
    let crop_chars = max_len.saturating_sub(23);

    // Collect crop_chars Unicode scalar values.
    let cropped: String = s.chars().take(crop_chars).collect();
    let cropped_char_len = cropped.chars().count();
    let remaining = s.chars().count() - cropped_char_len;

    format!("{cropped}…({remaining} more characters)")
}

/// Returns the singular or plural form of a word based on the count.
///
/// `inflect(1, "apple")` → `"apple"`
/// `inflect(2, "apple")` → `"apples"`
pub fn inflect(count: u64, word: &str) -> String {
    if count == 1 {
        word.to_string()
    } else {
        format!("{word}s")
    }
}

/// Crop content to a maximum number of lines, appending a truncation notice.
///
/// Mirrors TS `cropLines`: splits on `"\n"` (preserving trailing-newline semantics),
/// keeps up to `max_lines` lines, and appends a count notice if lines were removed.
pub fn crop_lines(content: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    if lines.len() <= max_lines {
        content.to_string()
    } else {
        let diff = lines.len() - max_lines + 1;
        let cropped: String = lines[..max_lines.saturating_sub(1)].join("\n");
        format!("{cropped}\n({diff} more {})", inflect(diff as u64, "line"))
    }
}

/// Formats a user mention with their ID.
///
/// `user_mention_with_id("123")` → `"<@123> (\`123\`)"`
pub fn user_mention_with_id(user_id: &str) -> String {
    format!("<@{user_id}> (`{user_id}`)")
}

/// Parse a duration string like "10m", "1h", "1d" into milliseconds.
///
/// Supports: s (seconds), m (minutes), h (hours), d (days), w (weeks).
pub fn parse_duration_string(input: &str) -> Option<u64> {
    let input = input.trim().to_lowercase();
    if input.parse::<f64>().ok().is_some() {
        let seconds = input.parse::<f64>().ok()?;
        if !seconds.is_finite() || seconds < 0.0 {
            return None;
        }
        return Some((seconds * 1000.0).round() as u64);
    }
    let token_re = Regex::new(
        r"(\d+(?:\.\d+)?)\s*(milliseconds|millisecond|msecs|msec|ms|seconds|second|secs|sec|s|minutes|minute|mins|min|m|hours|hour|hrs|hr|h|days|day|d|weeks|week|w|years|year|yrs|yr|y)",
    )
    .ok()?;

    let mut idx = 0usize;
    let mut total_ms = 0.0f64;
    let mut matched_any = false;

    for caps in token_re.captures_iter(&input) {
        let full = caps.get(0)?;
        if !input[idx..full.start()].trim().is_empty() {
            return None;
        }
        idx = full.end();
        matched_any = true;

        let value: f64 = caps.get(1)?.as_str().parse().ok()?;
        if !value.is_finite() || value < 0.0 {
            return None;
        }

        let unit = caps.get(2)?.as_str();
        let multiplier = match unit {
            "ms" | "msec" | "msecs" | "millisecond" | "milliseconds" => 1.0,
            "s" | "sec" | "secs" | "second" | "seconds" => 1000.0,
            "m" | "min" | "mins" | "minute" | "minutes" => 60.0 * 1000.0,
            "h" | "hr" | "hrs" | "hour" | "hours" => 60.0 * 60.0 * 1000.0,
            "d" | "day" | "days" => 24.0 * 60.0 * 60.0 * 1000.0,
            "w" | "week" | "weeks" => 7.0 * 24.0 * 60.0 * 60.0 * 1000.0,
            "y" | "yr" | "yrs" | "year" | "years" => 365.25 * 24.0 * 60.0 * 60.0 * 1000.0,
            _ => return None,
        };

        total_ms += value * multiplier;
    }

    if !matched_any || !input[idx..].trim().is_empty() || !total_ms.is_finite() || total_ms < 0.0 {
        return None;
    }

    Some(total_ms.round() as u64)
}

/// Validate a duration against minimum and maximum bounds.
pub fn validate_duration(duration_ms: u64, minimum: &str, maximum: &str) -> Result<(), String> {
    let min = parse_duration_string(minimum).unwrap_or(0);
    let max = parse_duration_string(maximum).unwrap_or(u64::MAX);

    if duration_ms < min {
        return Err(format!("Duration must be at least {minimum}."));
    }

    if duration_ms > max {
        return Err(format!("Duration must not exceed {maximum}."));
    }

    Ok(())
}

/// Format a duration in milliseconds to a human-readable string.
///
/// Mirrors TS `ms(value, { long: true })` style.
/// `format_duration_ms(3_661_000)` → `"1 hour"`
pub fn format_duration_ms(ms: u64) -> String {
    const SECOND: f64 = 1000.0;
    const MINUTE: f64 = 60.0 * SECOND;
    const HOUR: f64 = 60.0 * MINUTE;
    const DAY: f64 = 24.0 * HOUR;

    let value = ms as f64;
    if value >= DAY {
        return format_long_unit(value, DAY, "day");
    }
    if value >= HOUR {
        return format_long_unit(value, HOUR, "hour");
    }
    if value >= MINUTE {
        return format_long_unit(value, MINUTE, "minute");
    }
    if value >= SECOND {
        return format_long_unit(value, SECOND, "second");
    }

    format!("{ms} ms")
}

fn format_long_unit(value_ms: f64, unit_ms: f64, unit_name: &str) -> String {
    let rounded = (value_ms / unit_ms).round().max(0.0) as u64;
    let is_plural = value_ms >= unit_ms * 1.5;
    format!(
        "{} {}{}",
        rounded,
        unit_name,
        if is_plural { "s" } else { "" }
    )
}

/// Upload text to a hastebin service and return the URL.
///
/// Mirrors TS `hastebin()` exactly: posts to hst.sh only, no fallback chain.
/// Returns `None` if the request fails or the response is not OK.
pub async fn hastebin(content: &str, extension: &str) -> Option<String> {
    let response = HASTEBIN_CLIENT
        .post("https://hst.sh/documents")
        .body(content.to_string())
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let json: serde_json::Value = response.json().await.ok()?;
    let key = json.get("key").and_then(|k| k.as_str())?;
    Some(format!("https://hst.sh/{key}.{extension}"))
}

/// Parse channel scoping from raw scoping data.
#[derive(Debug, Clone)]
pub struct ChannelScoping {
    pub included: Vec<String>,
    pub excluded: Vec<String>,
}

/// Check if a resolved channel context is within scope.
///
/// `channel_id` should be the parent channel ID for thread messages.
/// `thread_id` should be set for thread messages.
/// `category_id` should be the category ID when available.
pub fn channel_in_scope_resolved(
    channel_id: &str,
    thread_id: Option<&str>,
    category_id: Option<&str>,
    scoping: &ChannelScoping,
) -> bool {
    // If no scoping rules are set, everything is in scope.
    if scoping.included.is_empty() && scoping.excluded.is_empty() {
        return true;
    }

    if !scoping.included.is_empty() {
        return scoping.included.iter().any(|id| id == channel_id)
            || thread_id
                .map(|tid| scoping.included.iter().any(|id| id == tid))
                .unwrap_or(false)
            || category_id
                .map(|cid| scoping.included.iter().any(|id| id == cid))
                .unwrap_or(false);
    }

    // No includes configured, so exclude checks decide.
    !(scoping.excluded.iter().any(|id| id == channel_id)
        || thread_id
            .map(|tid| scoping.excluded.iter().any(|id| id == tid))
            .unwrap_or(false)
        || category_id
            .map(|cid| scoping.excluded.iter().any(|id| id == cid))
            .unwrap_or(false))
}

/// Check whitelist status from KV or database.
pub async fn is_guild_whitelisted(
    db: &sea_orm::DatabaseConnection,
    kv: &crate::lib::kv::KvStore,
    guild_id: &str,
) -> bool {
    use sea_orm::EntityTrait;

    // Check KV cache first.
    let kv_key = format!("whitelists:{guild_id}");
    if let Ok(Some(entry)) = kv.get::<WhitelistCacheEntry>(&kv_key) {
        return entry.status;
    }

    // Cache miss: check database.
    let exists = crate::lib::entities::whitelist::Entity::find_by_id(guild_id)
        .one(db)
        .await
        .ok()
        .flatten()
        .is_some();

    // Update cache.
    let _ = kv.put(&kv_key, &WhitelistCacheEntry { status: exists });

    exists
}

/// KV cache entry for whitelist status.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct WhitelistCacheEntry {
    pub status: bool,
}
