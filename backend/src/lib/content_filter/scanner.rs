//! Core content filter scanner — runs TEXT/NSFW/OCR detectors via OpenAI.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use base64::Engine;
use poise::serenity_prelude as serenity;
use sea_orm::{EntityTrait, Set};
use serde_json::json;
use tracing::warn;

use super::alert::{self, MessageAlertData};
use super::types::{ChannelScanState, ContentFilterStatus, ContentPredictionData, ContentPredictions, Detector, PreAlertActionsResult};
use crate::lib::entities::{content_filter_alert, content_filter_log};
use crate::lib::config::schema::{ContentFilterConfig, DetectorMode};
use crate::utils::constants::cf;

const NSFW_MIN_SCORE_ADJUSTMENT: f64 = -0.12;
const NSFW_STRICT_MAX_MIN_SCORE: f64 = 0.01;
const MAX_MEDIA_FRAMES: usize = 10;
const OPENAI_MODERATION_MAX_IMAGES_PER_REQUEST: usize = 1;
const OPENAI_MAX_CONCURRENCY: usize = 5;
const OPENAI_REQUEST_MAX_RETRIES: u32 = 3;
const OPENAI_SOFT_RATE_LIMIT_COOLDOWN_MS: u64 = 10_000;
const OPENAI_HARD_RATE_LIMIT_COOLDOWN_MS: u64 = 30_000;
const OPENAI_RETRY_INITIAL_DELAY_MS: u64 = 500;
const OPENAI_RETRY_MAX_DELAY_MS: u64 = 15_000;

/// Global OpenAI rate limit state.
static OPENAI_RATE_LIMITED_UNTIL: AtomicI64 = AtomicI64::new(0);
static OPENAI_IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
static OPENAI_WAIT_QUEUE: Mutex<Vec<tokio::sync::oneshot::Sender<()>>> = Mutex::new(Vec::new());

fn openai_wait_queue() -> MutexGuard<'static, Vec<tokio::sync::oneshot::Sender<()>>> {
    OPENAI_WAIT_QUEUE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn openai_cooldown_remaining_internal() -> u64 {
    let limited_until = OPENAI_RATE_LIMITED_UNTIL.load(Ordering::Relaxed);
    if limited_until <= 0 {
        return 0;
    }
    let now = now_ms() as i64;
    if now >= limited_until {
        OPENAI_RATE_LIMITED_UNTIL.store(0, Ordering::Relaxed);
        return 0;
    }
    (limited_until - now) as u64
}

/// Returns remaining OpenAI cooldown in milliseconds.
pub fn openai_cooldown_remaining() -> u64 {
    openai_cooldown_remaining_internal()
}

async fn acquire_openai_slot() {
    loop {
        let current = OPENAI_IN_FLIGHT.load(Ordering::Relaxed);
        if current < OPENAI_MAX_CONCURRENCY {
            if OPENAI_IN_FLIGHT.compare_exchange(current, current + 1, Ordering::Relaxed, Ordering::Relaxed).is_ok() {
                return;
            }
        } else {
            let (tx, rx) = tokio::sync::oneshot::channel();
            openai_wait_queue().push(tx);
            let _ = rx.await;
        }
    }
}

fn release_openai_slot() {
    OPENAI_IN_FLIGHT.fetch_sub(1, Ordering::Relaxed);
    let tx = {
        let mut queue = openai_wait_queue();
        if queue.is_empty() {
            return;
        }
        queue.remove(0)
    };
    let _ = tx.send(());
}

/// Gets minimum score threshold based on detector mode.
pub fn get_min_score(config: &ContentFilterConfig) -> f64 {
    let base = match config.detector_mode {
        DetectorMode::Lenient => cf::HEURISTIC_LENIENT_SCORE,
        DetectorMode::Medium => cf::HEURISTIC_MEDIUM_SCORE,
        DetectorMode::Strict => cf::HEURISTIC_STRICT_SCORE,
    };
    base.clamp(0.0, 0.99)
}

/// Gets minimum score adjusted by channel state and user history.
pub fn get_min_score_with_state(
    config: &ContentFilterConfig,
    state: &ChannelScanState,
    author_id: &str,
) -> f64 {
    let mut base = get_min_score(config);
    let smoothed_fp = state.false_positive_ratio;
    base += smoothed_fp * cf::HEURISTIC_SCORE_FP_INFLUENCE;
    let now = now_ms();
    let user_alerts = state.flagged_users.get(author_id).cloned().unwrap_or_default();
    let recent_alerts = user_alerts
        .iter()
        .filter(|&&ts| now.saturating_sub(ts) <= cf::HEURISTIC_USER_RECENT_ALERT_WINDOW_MS)
        .count();
    let recent_normalized = (recent_alerts as f64 / 5.0).min(1.0);
    base -= recent_normalized * cf::HEURISTIC_SCORE_USER_ALERT_INFLUENCE;
    base.clamp(0.0, 0.99)
}

/// Checks whether the message author is immune from scanning.
async fn is_immune_author(
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &ContentFilterConfig,
) -> bool {
    if config.immune_roles.is_empty() {
        return false;
    }
    let Some(guild_id) = message.guild_id else { return false };
    let member = match guild_id.member(ctx, message.author.id).await {
        Ok(m) => m,
        Err(_) => return false,
    };
    for role_id_str in &config.immune_roles {
        if let Ok(rid) = role_id_str.parse::<u64>() {
            if member.roles.contains(&serenity::RoleId::new(rid)) {
                return true;
            }
        }
    }
    false
}

/// Parses the moderation response JSON into prediction data.
fn parse_moderation_response(
    response: &serde_json::Value,
    min_score: f64,
    require_flagged: bool,
    allowed_prefixes: Option<&[String]>,
) -> Vec<ContentPredictionData> {
    let mut predictions = Vec::new();

    let results = match response.get("results").and_then(|r| r.as_array()) {
        Some(r) => r,
        None => return predictions,
    };

    for result in results {
        let flagged = result.get("flagged").and_then(|f| f.as_bool()).unwrap_or(false);
        if require_flagged && !flagged {
            continue;
        }

        let scores = match result.get("category_scores").and_then(|s| s.as_object()) {
            Some(s) => s,
            None => continue,
        };
        let categories = match result.get("categories").and_then(|c| c.as_object()) {
            Some(c) => c,
            None => continue,
        };

        for (category, category_flagged) in categories {
            if !is_category_allowed(category, allowed_prefixes) {
                continue;
            }
            let passes_category_gate = if require_flagged {
                category_flagged.as_bool().unwrap_or(false)
            } else {
                true
            };
            if !passes_category_gate {
                continue;
            }
            let score = scores
                .get(category)
                .and_then(|score_val| score_val.as_f64())
                .unwrap_or(0.0);
            if score >= min_score {
                predictions.push(ContentPredictionData {
                    content: format!("Flagged: {category}"),
                    score: Some(format!("{score:.2}")),
                    category: Some(category.clone()),
                });
            }
        }
    }

    predictions
}

fn is_category_allowed(category: &str, allowed_prefixes: Option<&[String]>) -> bool {
    match allowed_prefixes {
        None => true,
        Some([]) => true,
        Some(prefixes) => prefixes.iter().any(|p| category == p || category.starts_with(&format!("{p}/"))),
    }
}

fn parse_retry_after_candidate(value: &str) -> Option<u64> {
    let parsed = value.trim().parse::<f64>().ok()?;
    if !parsed.is_finite() || parsed <= 0.0 {
        return None;
    }
    let ms = if parsed > 1000.0 { parsed } else { parsed * 1000.0 };
    Some(ms.round().max(1000.0) as u64)
}

fn get_retry_after_ms_from_headers(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let candidates = [
        headers.get("retry-after"),
        headers.get("x-ratelimit-reset-after"),
    ];

    for raw in candidates.into_iter().flatten() {
        if let Ok(text) = raw.to_str() {
            if let Some(ms) = parse_retry_after_candidate(text) {
                return Some(ms);
            }
        }
    }

    None
}

fn is_retryable_http_status(status: reqwest::StatusCode) -> bool {
    matches!(
        status.as_u16(),
        408 | 409 | 425 | 429 | 500..=599
    )
}

fn is_retryable_transport_error(err: &reqwest::Error) -> bool {
    if err.is_timeout() || err.is_connect() || err.is_request() {
        return true;
    }

    let normalized = err.to_string().to_lowercase();
    normalized.contains("timeout")
        || normalized.contains("timed out")
        || normalized.contains("abort")
        || normalized.contains("econnreset")
        || normalized.contains("eai_again")
        || normalized.contains("enetunreach")
        || normalized.contains("network")
        || normalized.contains("socket hang up")
        || normalized.contains("temporarily unavailable")
}

fn is_openai_rate_limit_error_message(message: &str) -> bool {
    let normalized = message.to_lowercase();
    normalized.contains("status 429")
        || (normalized.contains("openai")
            && (normalized.contains("rate limit") || normalized.contains("rate-limited")))
}

fn get_retry_after_ms_from_error_message(message: &str) -> Option<u64> {
    static RETRY_AFTER_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"retry after\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|seconds)?")
            .expect("valid retry-after regex")
    });
    static OPENAI_FOR_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"openai\s+rate-?limited\s+for\s+([0-9]+)\s*ms")
            .expect("valid openai retry regex")
    });

    let normalized = message.to_lowercase();

    if let Some(caps) = OPENAI_FOR_RE.captures(&normalized) {
        if let Some(ms) = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<u64>().ok())
        {
            return Some(ms.max(1000));
        }
    }

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

/// Calls the OpenAI moderation API with text input.
async fn call_openai_moderation_text(
    http_client: &reqwest::Client,
    api_key: &str,
    text: &str,
    ignore_cooldown: bool,
) -> Result<serde_json::Value, String> {
    let mut attempt = 0u32;
    let mut delay = OPENAI_RETRY_INITIAL_DELAY_MS;
    let max_retries = OPENAI_REQUEST_MAX_RETRIES.max(1);

    loop {
        let cooldown = openai_cooldown_remaining_internal();
        if cooldown > 0 && !ignore_cooldown {
            return Err(format!("OpenAI rate-limited for {cooldown}ms"));
        }

        acquire_openai_slot().await;

        let body = json!({
            "model": "omni-moderation-latest",
            "input": text
        });

        let result = http_client
            .post("https://api.openai.com/v1/moderations")
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        release_openai_slot();

        match result {
            Ok(response) => {
                let status = response.status();
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    let retry_after = get_retry_after_ms_from_headers(response.headers())
                        .unwrap_or(OPENAI_HARD_RATE_LIMIT_COOLDOWN_MS);
                    let cooldown = OPENAI_SOFT_RATE_LIMIT_COOLDOWN_MS.max(retry_after);
                    OPENAI_RATE_LIMITED_UNTIL
                        .store(now_ms() as i64 + cooldown as i64, Ordering::Relaxed);
                    return Err(format!(
                        "OpenAI moderation rate-limited; retry after {retry_after}ms"
                    ));
                }

                if !status.is_success() {
                    if is_retryable_http_status(status) && attempt + 1 < max_retries {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                        delay = (delay * 2).min(OPENAI_RETRY_MAX_DELAY_MS);
                        attempt += 1;
                        continue;
                    }
                    return Err(format!("OpenAI returned status {status}"));
                }

                let parsed = response
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|e| format!("Failed to parse OpenAI response: {e}"))?;
                return Ok(parsed);
            }
            Err(e) => {
                if is_retryable_transport_error(&e) && attempt + 1 < max_retries {
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                    delay = (delay * 2).min(OPENAI_RETRY_MAX_DELAY_MS);
                    attempt += 1;
                    continue;
                }
                return Err(format!("OpenAI request failed: {e}"));
            }
        }
    }
}

/// Calls the OpenAI moderation API with image input (base64).
async fn call_openai_moderation_image(
    http_client: &reqwest::Client,
    api_key: &str,
    base64_image: &str,
    extension: &str,
    ignore_cooldown: bool,
) -> Result<serde_json::Value, String> {
    let mut attempt = 0u32;
    let mut delay = OPENAI_RETRY_INITIAL_DELAY_MS;
    let max_retries = OPENAI_REQUEST_MAX_RETRIES.max(1);

    loop {
        let cooldown = openai_cooldown_remaining_internal();
        if cooldown > 0 && !ignore_cooldown {
            return Err(format!("OpenAI rate-limited for {cooldown}ms"));
        }

        acquire_openai_slot().await;

        let body = json!({
            "model": "omni-moderation-latest",
            "input": [{
                "type": "image_url",
                "image_url": {
                    "url": format!("data:image/{extension};base64,{base64_image}"),
                }
            }]
        });

        let result = http_client
            .post("https://api.openai.com/v1/moderations")
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        release_openai_slot();

        match result {
            Ok(response) => {
                let status = response.status();
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    let retry_after = get_retry_after_ms_from_headers(response.headers())
                        .unwrap_or(OPENAI_HARD_RATE_LIMIT_COOLDOWN_MS);
                    let cooldown = OPENAI_SOFT_RATE_LIMIT_COOLDOWN_MS.max(retry_after);
                    OPENAI_RATE_LIMITED_UNTIL
                        .store(now_ms() as i64 + cooldown as i64, Ordering::Relaxed);
                    return Err(format!(
                        "OpenAI moderation rate-limited; retry after {retry_after}ms"
                    ));
                }

                if !status.is_success() {
                    if is_retryable_http_status(status) && attempt + 1 < max_retries {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                        delay = (delay * 2).min(OPENAI_RETRY_MAX_DELAY_MS);
                        attempt += 1;
                        continue;
                    }
                    return Err(format!("OpenAI image returned status {status}"));
                }

                let parsed = response
                    .json::<serde_json::Value>()
                    .await
                    .map_err(|e| format!("Failed to parse OpenAI image response: {e}"))?;
                return Ok(parsed);
            }
            Err(e) => {
                if is_retryable_transport_error(&e) && attempt + 1 < max_retries {
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                    delay = (delay * 2).min(OPENAI_RETRY_MAX_DELAY_MS);
                    attempt += 1;
                    continue;
                }
                return Err(format!("OpenAI image request failed: {e}"));
            }
        }
    }
}

/// Runs the TEXT detector.
async fn scan_text(
    http_client: &reqwest::Client,
    api_key: &str,
    message: &serenity::Message,
    config: &ContentFilterConfig,
    channel_state: Option<&ChannelScanState>,
    prefetched: Option<&[serde_json::Value]>,
    bypass_cooldown: bool,
) -> Result<Option<ContentPredictions>, String> {
    if message.content.is_empty() {
        return Ok(None);
    }

    let min_score = match channel_state {
        Some(state) => get_min_score_with_state(config, state, &message.author.id.to_string()),
        None => get_min_score(config),
    };

    let predictions = if let Some(prefetched) = prefetched {
        let response = serde_json::json!({ "results": prefetched });
        parse_moderation_response(&response, min_score, true, None)
    } else {
        let response = call_openai_moderation_text(http_client, api_key, &message.content, bypass_cooldown).await?;
        parse_moderation_response(&response, min_score, true, None)
    };

    if predictions.is_empty() {
        return Ok(None);
    }

    Ok(Some(ContentPredictions {
        data: predictions,
        detector: Some(Detector::TEXT),
        content: vec![message.content.clone()],
    }))
}

/// Runs the NSFW detector on message media.
async fn scan_nsfw(
    http_client: &reqwest::Client,
    api_key: &str,
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &ContentFilterConfig,
    channel_state: Option<&ChannelScanState>,
    bypass_cooldown: bool,
) -> Result<Option<ContentPredictions>, String> {
    let media_scan = prepare_media_for_scan(http_client, ctx, message).await;
    if media_scan.frames.is_empty() {
        if media_scan.media_found {
            return Err("Media was found but no NSFW frames could be prepared; retry after 15000ms".to_string());
        }
        return Ok(None);
    }

    let mut min_score = match channel_state {
        Some(state) => get_min_score_with_state(config, state, &message.author.id.to_string()),
        None => get_min_score(config),
    };
    min_score = (min_score + NSFW_MIN_SCORE_ADJUSTMENT).clamp(0.0, 0.99);
    if config.detector_mode == DetectorMode::Strict {
        min_score = min_score.min(NSFW_STRICT_MAX_MIN_SCORE);
    }

    let require_flagged = config.detector_mode != DetectorMode::Strict;
    let allowed_prefixes = Some(vec!["sexual".to_string()]);

    let mut all_predictions = Vec::new();
    let frames: Vec<_> = media_scan.frames.into_iter().take(MAX_MEDIA_FRAMES).collect();
    let scan_inputs = crate::utils::media::serialize_multimodal_input(&frames);

    for chunk in scan_inputs.chunks(OPENAI_MODERATION_MAX_IMAGES_PER_REQUEST) {
        for item in chunk {
            let image_url = item
                .get("image_url")
                .and_then(|v| v.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let ext = image_url
                .split(';')
                .next()
                .and_then(|head| head.strip_prefix("data:image/"))
                .unwrap_or("png");
            let base64 = image_url
                .split(',')
                .nth(1)
                .unwrap_or_default();

            let response = call_openai_moderation_image(
                http_client,
                api_key,
                base64,
                ext,
                bypass_cooldown,
            )
            .await?;

            let preds = parse_moderation_response(
                &response,
                min_score,
                require_flagged,
                allowed_prefixes.as_deref(),
            );
            all_predictions.extend(preds);
        }
    }

    if all_predictions.is_empty() {
        return Ok(None);
    }

    Ok(Some(ContentPredictions {
        data: all_predictions,
        detector: Some(Detector::NSFW),
        content: media_scan.problematic_content,
    }))
}

/// Runs the OCR detector.
async fn scan_ocr(
    http_client: &reqwest::Client,
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &ContentFilterConfig,
) -> Result<Option<ContentPredictions>, String> {
    let media_scan = prepare_media_for_scan(http_client, ctx, message).await;
    if media_scan.frames.is_empty() {
        if media_scan.media_found {
            warn!(
                "CF OCR skipped: media exists but no OCR frames could be prepared for message {}.",
                message.id
            );
        }
        return Ok(None);
    }

    let keywords = &config.ocr_filter_keywords;
    let regex_patterns = &config.ocr_filter_regex;

    let mut predictions = Vec::new();
    let mut matched_content = Vec::new();
    let mut frame_failures = 0usize;

    for meta in &media_scan.frames {
        let image_data = if let Some(buffer) = &meta.buffer {
            buffer.clone()
        } else if let Some(b64) = &meta.base64 {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD.decode(b64) {
                Ok(bytes) => bytes,
                Err(_) => { frame_failures += 1; continue; }
            }
        } else {
            frame_failures += 1;
            continue;
        };

        match crate::utils::media::run_ocr(&image_data).await {
            Ok(Some(text)) => process_ocr_text(&text, keywords, regex_patterns, &mut predictions, &mut matched_content),
            Ok(None) => {} // OCR ran but image had no text — not a failure
            Err(()) => { frame_failures += 1; }
        }
    }

    if !media_scan.frames.is_empty() && frame_failures >= media_scan.frames.len() {
        return Err("OCR failed for all prepared frames".to_string());
    }

    if predictions.is_empty() {
        return Ok(None);
    }

    Ok(Some(ContentPredictions {
        data: predictions,
        detector: Some(Detector::OCR),
        content: matched_content,
    }))
}

fn process_ocr_text(
    text: &str,
    keywords: &[String],
    regex_patterns: &[String],
    predictions: &mut Vec<ContentPredictionData>,
    matched_content: &mut Vec<String>,
) {
    let lower = text.to_lowercase();
    for keyword in keywords {
        if lower.contains(&keyword.to_lowercase()) {
            predictions.push(ContentPredictionData {
                content: format!("OCR keyword match: \"{}\"", keyword),
                score: None,
                category: None,
            });
            matched_content.push(keyword.clone());
        }
    }

    // TS builds `compiledRegex` with flatMap, dropping invalid regexes, but then labels
    // matches with `regexPatterns[i]`. Preserve that index behavior for exact parity.
    let compiled_regex: Vec<regex::Regex> = regex_patterns
        .iter()
        .filter_map(|pattern| regex::Regex::new(&format!("(?i){pattern}")).ok())
        .collect();

    for (i, re) in compiled_regex.iter().enumerate() {
        if re.is_match(text) {
            let label = regex_patterns.get(i).cloned().unwrap_or_default();
            predictions.push(ContentPredictionData {
                content: format!("OCR regex match: \"{}\"", label),
                score: None,
                category: None,
            });
            matched_content.push(format!("Pattern: {label}"));
        }
    }
}

struct PreparedMedia {
    frames: Vec<crate::utils::media::MediaMetadata>,
    problematic_content: Vec<String>,
    media_found: bool,
}

/// Prepares media from a message for scanning.
///
/// Mirrors TS `_prepareMediaForScan` which calls `MediaUtils.serializeMedia` — that function
/// collects emojis, stickers, attachments, and embeds.  We replicate the same four collection
/// paths here.
async fn prepare_media_for_scan(
    http_client: &reqwest::Client,
    ctx: &serenity::Context,
    message: &serenity::Message,
) -> PreparedMedia {
    let mut all_media: Vec<crate::utils::media::MediaMetadata> = Vec::new();

    // Attachments.
    for attachment in &message.attachments {
        if let Some(meta) = crate::utils::media::fetch_media_metadata(http_client, &attachment.url).await {
            all_media.push(meta);
        }
    }

    // Custom emojis embedded in the message content.
    let emoji_media = crate::utils::media::serialize_emojis(http_client, &message.content).await;
    all_media.extend(emoji_media);

    // Stickers. TS `serializeStickers` skips standard Discord sticker-pack stickers and
    // processes guild/custom stickers only.
    for sticker in &message.sticker_items {
        use serenity::model::sticker::{StickerFormatType, StickerType};

        let Ok(full_sticker) = sticker.to_sticker(ctx.http.as_ref()).await else {
            continue;
        };

        if full_sticker.kind == StickerType::Standard {
            continue;
        }

        if sticker.format_type == StickerFormatType::Lottie {
            continue;
        }

        let Some(url) = sticker.image_url() else {
            continue;
        };

        if let Some(meta) = crate::utils::media::fetch_media_metadata(http_client, &url).await {
            all_media.push(meta);
        }
    }

    // Embeds — use the embed URL or thumbnail URL (mirrors TS serializeEmbeds logic).
    for embed in &message.embeds {
        let url: Option<&str> = embed
            .url
            .as_deref()
            .or_else(|| embed.thumbnail.as_ref().map(|t| t.url.as_str()));
        if let Some(url) = url {
            if let Some(meta) = crate::utils::media::fetch_media_metadata(http_client, url).await {
                all_media.push(meta);
            }
        }
    }

    if all_media.is_empty() {
        return PreparedMedia {
            frames: Vec::new(),
            problematic_content: Vec::new(),
            media_found: false,
        };
    }

    let problematic_content = all_media
        .iter()
        .map(|item| item.url.clone().unwrap_or_else(|| "unknown".to_string()))
        .collect::<Vec<_>>();
    let media_for_fallback = all_media.clone();
    let mut frames = crate::utils::media::process_media_for_scan(all_media).await;
    if frames.is_empty() {
        frames = fallback_media_conversion(media_for_fallback).await;
    }

    PreparedMedia {
        frames,
        problematic_content,
        media_found: true,
    }
}

async fn fallback_media_conversion(
    media: Vec<crate::utils::media::MediaMetadata>,
) -> Vec<crate::utils::media::MediaMetadata> {
    let mut frames = Vec::new();

    for metadata in media {
        if metadata.url.is_none() {
            continue;
        }

        if let (Some(buffer), Some(_extension)) = (metadata.buffer.as_ref(), metadata.extension) {
            let converted = crate::utils::media::process_media_for_scan(vec![metadata.clone()]).await;
            if !converted.is_empty() {
                frames.extend(converted);
                continue;
            }

            if let Some(png) = crate::utils::media::resize_and_compress_png(buffer, 512) {
                frames.push(crate::utils::media::MediaMetadata {
                    url: None,
                    buffer: None,
                    base64: Some(base64::engine::general_purpose::STANDARD.encode(&png)),
                    extension: Some(crate::utils::media::MediaExtension::Png),
                });
            }
        }
    }

    frames
}

/// Runs all configured detectors on a message.
#[allow(clippy::too_many_arguments)]
pub async fn run_detectors(
    http_client: &reqwest::Client,
    api_key: &str,
    ctx: &serenity::Context,
    message: &serenity::Message,
    config: &ContentFilterConfig,
    channel_state: Option<&ChannelScanState>,
    prefetched_text: Option<&[serde_json::Value]>,
    bypass_cooldown: bool,
) -> Result<Vec<ContentPredictions>, String> {
    if message.author.bot {
        return Ok(vec![]);
    }
    if is_immune_author(ctx, message, config).await {
        return Ok(vec![]);
    }

    let mut all_predictions = Vec::new();
    let mut failures = Vec::new();
    let mut openai_rate_limit_retry_after_ms: Option<u64> = None;

    let mut detector_tasks = Vec::with_capacity(config.detectors.len());
    for detector in config.detectors.iter().copied() {
        let http_client = http_client.clone();
        let api_key = api_key.to_string();
        let ctx = ctx.clone();
        let message = message.clone();
        let config = config.clone();
        let channel_state = channel_state.cloned();
        let prefetched_text = prefetched_text.map(|v| v.to_vec());

        detector_tasks.push(tokio::spawn(async move {
            let result: Result<Option<ContentPredictions>, String> = match detector {
                crate::lib::config::schema::Detector::Text => {
                    scan_text(
                        &http_client,
                        &api_key,
                        &message,
                        &config,
                        channel_state.as_ref(),
                        prefetched_text.as_deref(),
                        bypass_cooldown,
                    )
                    .await
                }
                crate::lib::config::schema::Detector::Nsfw => {
                    scan_nsfw(
                        &http_client,
                        &api_key,
                        &ctx,
                        &message,
                        &config,
                        channel_state.as_ref(),
                        bypass_cooldown,
                    )
                    .await
                }
                crate::lib::config::schema::Detector::Ocr => {
                    scan_ocr(&http_client, &ctx, &message, &config).await
                }
            };

            (detector, result)
        }));
    }

    for task in detector_tasks {
        let (detector, result) = match task.await {
            Ok(result) => result,
            Err(e) => {
                failures.push(format!("Detector task failed: {e}"));
                continue;
            }
        };

        match result {
            Ok(Some(predictions)) => all_predictions.push(predictions),
            Ok(None) => {}
            Err(e) => {
                if matches!(detector, crate::lib::config::schema::Detector::Ocr) {
                    warn!(
                        "CF OCR detector unavailable for message {}; skipping OCR this scan: {}",
                        message.id,
                        e
                    );
                    continue;
                }

                if is_openai_rate_limit_error_message(&e) {
                    if let Some(retry_after) = get_retry_after_ms_from_error_message(&e) {
                        match openai_rate_limit_retry_after_ms {
                            Some(current) if retry_after <= current => {}
                            _ => openai_rate_limit_retry_after_ms = Some(retry_after),
                        }
                    }
                    failures.push("OpenAI moderation rate-limited".to_string());
                    continue;
                }

                failures.push(e);
            }
        }
    }

    if !failures.is_empty() {
        if let Some(retry_after_ms) = openai_rate_limit_retry_after_ms {
            return Err(format!(
                "OpenAI moderation rate-limited; retry after {retry_after_ms}ms"
            ));
        }
        return Err(format!(
            "One or more detectors failed: {}",
            failures.join(" | ")
        ));
    }

    Ok(all_predictions)
}

/// Batch scan text inputs using OpenAI moderation API.
pub async fn batch_scan_text(
    http_client: &reqwest::Client,
    api_key: &str,
    inputs: Vec<&str>,
    max_retries: u32,
) -> Result<Vec<serde_json::Value>, String> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }

    let mut attempt = 0;
    let mut delay = OPENAI_RETRY_INITIAL_DELAY_MS;

    loop {
        let cooldown = openai_cooldown_remaining_internal();
        if cooldown > 0 {
            return Err(format!("OpenAI rate-limited for {cooldown}ms"));
        }

        acquire_openai_slot().await;

        let body = json!({
            "model": "omni-moderation-latest",
            "input": inputs,
        });

        let result = http_client
            .post("https://api.openai.com/v1/moderations")
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        release_openai_slot();

        match result {
            Ok(response) => {
                let status = response.status();
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    let retry_after = get_retry_after_ms_from_headers(response.headers())
                        .unwrap_or(OPENAI_HARD_RATE_LIMIT_COOLDOWN_MS);
                    let cooldown = OPENAI_SOFT_RATE_LIMIT_COOLDOWN_MS.max(retry_after);
                    OPENAI_RATE_LIMITED_UNTIL
                        .store(now_ms() as i64 + cooldown as i64, Ordering::Relaxed);
                    return Err(format!(
                        "OpenAI moderation hard rate limit; retry after {retry_after}ms"
                    ));
                }

                if !status.is_success() {
                    if is_retryable_http_status(status) && attempt + 1 < max_retries.max(1) {
                        tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                        delay = (delay * 2).min(OPENAI_RETRY_MAX_DELAY_MS);
                        attempt += 1;
                        continue;
                    }
                    return Err(format!("OpenAI returned status {status}"));
                }

                let json: serde_json::Value = response
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse OpenAI response: {e}"))?;
                let results = json
                    .get("results")
                    .and_then(|r| r.as_array())
                    .cloned()
                    .unwrap_or_default();
                return Ok(results);
            }
            Err(e) => {
                if is_retryable_transport_error(&e) && attempt + 1 < max_retries.max(1) {
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                    delay = (delay * 2).min(OPENAI_RETRY_MAX_DELAY_MS);
                    attempt += 1;
                    continue;
                }
                return Err(format!("OpenAI request failed: {e}"));
            }
        }
    }
}

/// Applies pre-alert actions (delete message, timeout user).
pub async fn apply_pre_alert_actions(
    ctx: &serenity::Context,
    message: &serenity::Message,
    predictions: &[ContentPredictions],
    config: &ContentFilterConfig,
) -> PreAlertActionsResult {
    let action_plan = resolve_detector_action_plan(predictions, config);
    let mut flags = Vec::new();
    let mut disable_delete_button = false;
    let mut deleted_before_alert = false;

    if let Some(dur_ms) = action_plan.timeout_duration_ms {
        if apply_timeout(ctx, message, dur_ms, &action_plan.triggered_detectors).await {
            flags.push(format!("Offender Timed Out ({})", crate::utils::format_duration_ms(dur_ms)));
        }
    }

    if action_plan.delete_message {
        match message.channel_id.delete_message(ctx, message.id).await {
            Ok(_) => {
                let bot_id = ctx.cache.current_user().id;
                flags.push(format!("Message Deleted (by <@{bot_id}>)"));
                disable_delete_button = true;
                deleted_before_alert = true;
            }
            Err(e) if e.to_string().contains("10008") => {
                disable_delete_button = true;
                deleted_before_alert = true;
            }
            _ => {}
        }
    }

    if !deleted_before_alert {
        if let Err(e) = message.channel_id.message(ctx, message.id).await {
            if e.to_string().contains("10008") {
                disable_delete_button = true;
                deleted_before_alert = true;
            }
        }
    }

    PreAlertActionsResult { flags, disable_delete_button, deleted_before_alert }
}

async fn apply_timeout(
    ctx: &serenity::Context,
    message: &serenity::Message,
    duration_ms: u64,
    triggered_detectors: &[Detector],
) -> bool {
    let guild_id = match message.guild_id {
        Some(id) => id,
        None => return false,
    };
    let channel = match message.channel_id.to_channel(ctx).await.ok().and_then(|c| c.guild()) {
        Some(c) => c,
        None => return false,
    };
    let bot_id = ctx.cache.current_user().id;

    // Fetch bot member first so we can use guild.user_permissions_in (avoids the
    // guild.members cache-miss that permissions_for_user silently returns false for).
    let bot_member = match guild_id.member(ctx, bot_id).await {
        Ok(m) => m,
        Err(_) => return false,
    };

    let (guild_owner_id, guild_roles) = if let Some(guild) = guild_id.to_guild_cached(ctx) {
        (Some(guild.owner_id), Some(guild.roles.clone()))
    } else {
        let owner_id = guild_id.to_partial_guild(ctx).await.ok().map(|g| g.owner_id);
        (owner_id, None)
    };

    let has_moderate_permission = guild_id
        .to_guild_cached(ctx)
        .map(|guild| guild.user_permissions_in(&channel, &bot_member).moderate_members())
        .unwrap_or(false);
    if !has_moderate_permission {
        return false;
    }

    let mut target = match guild_id.member(ctx, message.author.id).await {
        Ok(m) => m,
        Err(_) => return false,
    };
    // TS: target.isCommunicationDisabled() — only true when timeout is still active (in the future).
    if target.communication_disabled_until.is_some_and(|until| until > serenity::Timestamp::now()) {
        return false;
    }

    let validation = crate::utils::moderation::validate_action(
        target.user.id,
        Some(&target),
        &bot_member,
        bot_id,
        "Mute",
        guild_owner_id,
        Some(&bot_member),
        guild_roles.as_ref(),
    );
    if !validation.ok {
        return false;
    }

    let detector_summary: String = if triggered_detectors.is_empty() {
        "unknown".to_string()
    } else {
        triggered_detectors
            .iter()
            .map(|d| d.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let reason = truncate_audit_reason(&format!(
        "Automatic timeout from content filter ({detector_summary})"
    ));
    let timeout_until = chrono::Utc::now() + chrono::Duration::milliseconds(duration_ms as i64);
    target
        .edit(
            ctx,
            serenity::EditMember::new()
                .disable_communication_until_datetime(serenity::Timestamp::from(timeout_until))
                .audit_log_reason(&reason),
        )
        .await
        .is_ok()
}

fn truncate_audit_reason(reason: &str) -> String {
    if reason.chars().count() <= 512 {
        return reason.to_string();
    }

    let cropped: String = reason.chars().take(509).collect();
    format!("{cropped}...")
}

struct DetectorActionPlan {
    delete_message: bool,
    timeout_duration_ms: Option<u64>,
    triggered_detectors: Vec<Detector>,
}

fn resolve_detector_action_plan(
    predictions: &[ContentPredictions],
    config: &ContentFilterConfig,
) -> DetectorActionPlan {
    let mut delete_message = false;
    let mut timeout_duration_ms = 0u64;
    let mut apply_nsfw_actions_to_text = false;
    let mut triggered_detectors = Vec::<Detector>::new();

    for prediction in predictions {
        let Some(detector) = prediction.detector else { continue };
        if !triggered_detectors.contains(&detector) {
            triggered_detectors.push(detector);
        }

        let detector_actions = match detector {
            Detector::NSFW => &config.detector_actions.nsfw.base,
            Detector::OCR => &config.detector_actions.ocr,
            Detector::TEXT => &config.detector_actions.text,
        };

        if detector_actions.delete_message {
            delete_message = true;
        }
        if detector_actions.timeout_user {
            timeout_duration_ms = timeout_duration_ms.max(detector_actions.timeout_duration_ms);
        }

        if detector == Detector::TEXT
            && config.detector_actions.nsfw.apply_to_text_nsfw
            && prediction_contains_text_nsfw(prediction)
        {
            apply_nsfw_actions_to_text = true;
        }
    }

    if apply_nsfw_actions_to_text {
        let nsfw = &config.detector_actions.nsfw.base;
        if nsfw.delete_message {
            delete_message = true;
        }
        if nsfw.timeout_user {
            timeout_duration_ms = timeout_duration_ms.max(nsfw.timeout_duration_ms);
        }
    }

    DetectorActionPlan {
        delete_message,
        timeout_duration_ms: if timeout_duration_ms > 0 {
            Some(timeout_duration_ms)
        } else {
            None
        },
        triggered_detectors,
    }
}

fn prediction_contains_text_nsfw(prediction: &ContentPredictions) -> bool {
    prediction.data.iter().any(|item| {
        if let Some(category) = &item.category {
            let normalized = category.to_lowercase();
            if normalized == "sexual" || normalized.starts_with("sexual/") {
                return true;
            }
        }

        item.content.to_lowercase().contains("flagged: sexual")
    })
}

/// Creates and stores a content filter alert, sends webhook.
pub async fn create_alert(
    db: &sea_orm::DatabaseConnection,
    http_client: &reqwest::Client,
    ctx: &serenity::Context,
    message: &serenity::Message,
    predictions: Vec<ContentPredictions>,
    scan_type: &str,
    config: &ContentFilterConfig,
) -> Result<(), String> {
    let webhook_url = match &config.webhook_url {
        Some(url) => url.clone(),
        None => return Ok(()),
    };

    let msg_data = match MessageAlertData::from_message(message) {
        Some(d) => d,
        None => return Ok(()),
    };

    let pre_alert = apply_pre_alert_actions(ctx, message, &predictions, config).await;

    let payload = alert::build_payload(
        &predictions,
        scan_type,
        &msg_data,
        config,
        &pre_alert.flags,
        pre_alert.disable_delete_button,
    );

    // send_webhook returns (alert_message_id, alert_channel_id) — matching TS where
    // alertMessage.id and alertMessage.channel_id come from the webhook response.
    let (alert_message_id, alert_channel_id) = alert::send_webhook(http_client, &webhook_url, &payload)
        .await
        .map_err(|e| format!("Webhook dispatch failed: {e}; retry after 20000ms"))?;

    let alert = content_filter_alert::ActiveModel {
        id: Set(alert_message_id.clone()),
        guild_id: Set(msg_data.guild_id.clone()),
        message_id: Set(msg_data.message_id.clone()),
        channel_id: Set(msg_data.channel_id.clone()),
        alert_message_id: Set(alert_message_id.clone()),
        alert_channel_id: Set(alert_channel_id),
        offender_id: Set(msg_data.author_id.clone()),
        detectors: Set(payload.detectors_used.clone()),
        highest_score: Set(payload.highest_score),
        mod_status: Set(ContentFilterStatus::Pending),
        del_status: Set(if pre_alert.deleted_before_alert {
            ContentFilterStatus::Deleted
        } else {
            ContentFilterStatus::Pending
        }),
        ..Default::default()
    };

    if let Err(err) = content_filter_alert::Entity::insert(alert).exec(db).await {
        warn!(
            alert_message_id,
            message_id = %msg_data.message_id,
            guild_id = %msg_data.guild_id,
            "Failed to persist content-filter alert: {err}"
        );
    }

    if !payload.problematic_content.is_empty() {
        let content = payload.problematic_content.join("\n---\n");
        // Use alert_message_id as the log's id, matching TS where `id: alert.id`
        // (alert.id is the alertMessage.id returned from the webhook).
        let log = content_filter_log::ActiveModel {
            id: Set(alert_message_id.clone()),
            guild_id: Set(msg_data.guild_id.clone()),
            alert_id: Set(alert_message_id.clone()),
            content: Set(content),
            ..Default::default()
        };

        if let Err(err) = content_filter_log::Entity::insert(log).exec(db).await {
            warn!(
                alert_message_id,
                message_id = %msg_data.message_id,
                guild_id = %msg_data.guild_id,
                "Failed to persist content-filter log: {err}"
            );
        }
    }

    Ok(())
}
