//! Content filter alert renderer.

use poise::serenity_prelude as serenity;
use serde_json::json;

use super::types::{ContentPredictions, Detector};
use crate::lib::config::schema::{ContentFilterConfig, ContentFilterVerbosity};

/// Built alert payload ready for webhook dispatch.
pub struct AlertPayload {
    pub content: Option<String>,
    pub embeds: Vec<serde_json::Value>,
    pub components: Vec<serde_json::Value>,
    pub detectors_used: Vec<Detector>,
    pub highest_score: f64,
    pub problematic_content: Vec<String>,
}

/// Data needed to render an alert (extracted from the Discord message before any awaits).
pub struct MessageAlertData {
    pub message_id: String,
    pub channel_id: String,
    pub guild_id: String,
    pub author_id: String,
    pub author_avatar_url: String,
    pub message_url: String,
    pub created_timestamp_ms: u64,
}

impl MessageAlertData {
    pub fn from_message(msg: &serenity::Message) -> Option<Self> {
        let guild_id = msg.guild_id?.to_string();
        let channel_id = msg.channel_id.to_string();
        let message_id = msg.id.to_string();
        let author_id = msg.author.id.to_string();
        let author_avatar_url = msg.author.face();
        let message_url = format!(
            "https://discord.com/channels/{}/{}/{}",
            guild_id, channel_id, message_id
        );
        let created_timestamp_ms = msg.timestamp.timestamp_millis().max(0) as u64;

        Some(Self {
            message_id,
            channel_id,
            guild_id,
            author_id,
            author_avatar_url,
            message_url,
            created_timestamp_ms,
        })
    }
}

/// Builds the content-filter alert webhook payload.
pub fn build_payload(
    predictions: &[ContentPredictions],
    scan_type: &str,
    msg_data: &MessageAlertData,
    config: &ContentFilterConfig,
    flags: &[String],
    disable_delete_button: bool,
) -> AlertPayload {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let response_time_ms = now_ms.saturating_sub(msg_data.created_timestamp_ms);
    let response_time_str = format_response_time_ms(response_time_ms);

    let mut highest_score = 0.0f64;
    let mut detectors_used: Vec<Detector> = Vec::new();
    let mut problematic_content: Vec<String> = Vec::new();
    let mut findings: Vec<String> = Vec::new();

    for prediction in predictions {
        if let Some(det) = prediction.detector {
            if !detectors_used.contains(&det) {
                detectors_used.push(det);
            }
        }
        problematic_content.extend(prediction.content.clone());

        let label = prediction
            .detector
            .as_ref()
            .map(|d| format!("[{}]", d))
            .unwrap_or_else(|| "[HEURISTIC]".to_string());

        for data in &prediction.data {
            if let Some(ref score_str) = data.score {
                if let Ok(score) = score_str.parse::<f64>() {
                    if score > highest_score {
                        highest_score = score;
                    }
                }
            }

            let line = if let Some(ref score) = data.score {
                format!("{label} {} ({score})", data.content)
            } else {
                format!("{label} {}", data.content)
            };
            findings.push(line);
        }
    }

    let user_mention = format!("<@{}> (`{}`)", msg_data.author_id, msg_data.author_id);
    let jump_link = format!("[Jump to message]({})", msg_data.message_url);

    let mut fields = vec![
        json!({ "name": "Offender", "value": user_mention, "inline": false }),
        json!({ "name": "Message", "value": jump_link, "inline": false }),
    ];

    if config.verbosity != ContentFilterVerbosity::Minimal && !findings.is_empty() {
        let preview: String = findings
            .iter()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let truncated = if preview.chars().count() > 1024 {
            format!("{}...", preview.chars().take(1021).collect::<String>())
        } else {
            preview
        };
        fields.push(json!({ "name": "Detections", "value": truncated, "inline": false }));
    }

    if !flags.is_empty() {
        fields.push(json!({ "name": "Flags", "value": flags.join("\n"), "inline": false }));
    }

    let embed = json!({
        "color": 0x3498DB,
        "author": { "name": format!("{} | {}", scan_type, response_time_str) },
        "thumbnail": { "url": msg_data.author_avatar_url },
        "fields": fields,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    // Buttons: delete, resolve, false-positive, view-content
    let del_button = json!({
        "type": 2,
        "label": "Delete Message",
        "style": 4, // Danger
        "custom_id": format!("cfb1:del:{}:{}", msg_data.message_id, msg_data.channel_id),
        "disabled": disable_delete_button,
    });
    let resolve_button = json!({
        "type": 2,
        "label": "Resolve Alert",
        "style": 3, // Success
        "custom_id": format!("cfb1:res:{}", msg_data.message_id),
    });
    let fp_button = json!({
        "type": 2,
        "label": "Mark False Positive",
        "style": 2, // Secondary
        "custom_id": format!("cfb1:fp:{}:{}", msg_data.channel_id, msg_data.message_id),
    });
    let content_button = json!({
        "type": 2,
        "label": "View Details",
        "style": 1, // Primary
        "custom_id": format!("cfb1:content:{}", msg_data.message_id),
    });

    let action_row = json!({
        "type": 1,
        "components": [del_button, resolve_button, fp_button, content_button],
    });

    let notify_content = if !config.notify_roles.is_empty() {
        let mentions: String = config
            .notify_roles
            .iter()
            .map(|r| {
                if r == "here" {
                    "@here".to_string()
                } else {
                    format!("<@&{r}>")
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        Some(mentions)
    } else {
        None
    };

    AlertPayload {
        content: notify_content,
        embeds: vec![embed],
        components: vec![action_row],
        detectors_used,
        highest_score,
        problematic_content,
    }
}

/// Sends the alert payload to the webhook URL.
///
/// Returns `(message_id, channel_id)` from the webhook response, matching the fields
/// stored in `ContentFilterAlert.alert_message_id` and `ContentFilterAlert.alert_channel_id`
/// in the TS implementation (which uses `alertMessage.id` and `alertMessage.channel_id`).
pub async fn send_webhook(
    client: &reqwest::Client,
    webhook_url: &str,
    payload: &AlertPayload,
) -> Result<(String, String), String> {
    let body = json!({
        "content": payload.content,
        "embeds": payload.embeds,
        "components": payload.components,
        "allowed_mentions": { "parse": ["roles"] },
    });

    let response = client
        .post(webhook_url)
        .query(&[("wait", "true")])
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Webhook request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Webhook returned {status}: {text}"));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse webhook response: {e}"))?;

    let message_id = json
        .get("id")
        .and_then(|id| id.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Webhook response missing message ID".to_string())?;

    let channel_id = json
        .get("channel_id")
        .and_then(|id| id.as_str())
        .map(str::to_string)
        .unwrap_or_default();

    Ok((message_id, channel_id))
}

///
/// The `ms` library uses fixed unit constants (s=1000, m=60000, h=3600000, d=86400000)
/// and divides the raw millisecond value directly by each unit — it does NOT chain
/// rounded intermediate values.  Pluralisation follows `isPlural = msAbs >= n * 1.5`,
/// which is equivalent to `Math.round(ms / n) >= 2`.
fn format_response_time_ms(ms: u64) -> String {
    const S: u64 = 1_000;
    const M: u64 = 60 * S;
    const H: u64 = 60 * M;
    const D: u64 = 24 * H;

    if ms < S {
        return format!("{ms} ms");
    }
    if ms < M {
        let n = (ms as f64 / S as f64).round() as u64;
        return format!("{} second{}", n, if n == 1 { "" } else { "s" });
    }
    if ms < H {
        let n = (ms as f64 / M as f64).round() as u64;
        return format!("{} minute{}", n, if n == 1 { "" } else { "s" });
    }
    if ms < D {
        let n = (ms as f64 / H as f64).round() as u64;
        return format!("{} hour{}", n, if n == 1 { "" } else { "s" });
    }
    let n = (ms as f64 / D as f64).round() as u64;
    format!("{} day{}", n, if n == 1 { "" } else { "s" })
}
