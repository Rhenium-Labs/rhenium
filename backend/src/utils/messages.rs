use std::sync::Arc;

use poise::serenity_prelude as serenity;
use regex::Regex;

///
/// Mirrors the TS pre-clean steps:
/// 1) Escape custom emoji mention separators.
/// 2) Normalize user mentions to include raw IDs.
/// 3) Run mention/channel cleaning using Serenity's cache-backed content_safe utility.
pub fn clean_content(
    input: &str,
    cache: &serenity::Cache,
    guild_id: Option<serenity::GuildId>,
    mentions: &[serenity::User],
) -> String {
    let emoji_re = Regex::new(r"<(a?):([^:\n\r]+):(\d{17,19})>").expect("valid emoji regex");
    let mention_re = Regex::new(r"<@!?(\d{17,19})>").expect("valid mention regex");

    let escaped = emoji_re.replace_all(input, "<$1\\:$2\\:$3>");
    let normalized = mention_re.replace_all(&escaped, "<@$1> ($1)");

    let mut options = serenity::ContentSafeOptions::default();
    if let Some(gid) = guild_id {
        options = options.display_as_member_from(gid);
    }

    serenity::content_safe(cache, normalized.as_ref(), &options, mentions)
}

/// Escapes triple-backtick sequences so content can be safely placed inside a code block.
///
/// Mirrors `escapeCodeBlock` from discord.js `@discordjs/formatters`:
/// replaces ` ``` ` with `\`\`\`` (backslash-escaped backticks).
pub fn escape_code_block(text: &str) -> String {
    text.replace("```", "\\`\\`\\`")
}

/// Wraps text in a Discord code block (` ``` `).
pub fn code_block(text: &str) -> String {
    format!("```\n{text}\n```")
}

/// Data for [`format_message_content`].
pub struct FormatMessageContentData<'a> {
    pub url: Option<&'a str>,
    pub content: Option<&'a str>,
    pub sticker_id: Option<&'a str>,
    pub author_id: Option<&'a str>,
    pub created_at: Option<i64>,
    pub include_url: bool,
}

impl<'a> FormatMessageContentData<'a> {
    /// Create a new instance with sensible defaults (`include_url = true`).
    pub fn new() -> Self {
        Self {
            url: None,
            content: None,
            sticker_id: None,
            author_id: None,
            created_at: None,
            include_url: true,
        }
    }
}

impl<'a> Default for FormatMessageContentData<'a> {
    fn default() -> Self {
        Self::new()
    }
}

/// Formats message content, including stickers and URLs, for display.
///
///
/// - If `content` is `None` or empty, produces `\`\`\`Unknown content.\`\`\``.
/// - If `escapedContent.len() > 900`, uploads to hastebin and returns a hyperlink.
/// - Otherwise wraps in a code block, truncated to `max(0, 900 - prefix.len())` chars.
pub async fn format_message_content(
    http: Arc<serenity::Http>,
    data: FormatMessageContentData<'_>,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    match (data.created_at, data.author_id) {
        (Some(ts), Some(author_id)) => {
            parts.push(format!("Sent by <@{author_id}> on <t:{ts}:f>"));
        }
        (Some(ts), None) => {
            parts.push(format!("Sent on <t:{ts}:f>"));
        }
        (None, Some(author_id)) => {
            parts.push(format!("Sent by <@{author_id}>"));
        }
        (None, None) => {}
    }

    if let (Some(url), true) = (data.url, data.include_url) {
        parts.push(format!("[Jump to message]({url})"));
    }

    if let Some(sticker_id) = data.sticker_id {
        if let Ok(id) = sticker_id.parse::<u64>() {
            if let Ok(sticker) = serenity::StickerId::new(id).to_sticker(Arc::clone(&http)).await {
                if sticker.format_type == serenity::StickerFormatType::Lottie {
                    parts.push(format!("Lottie Sticker: {}", sticker.name));
                } else if let Some(sticker_url) = sticker.image_url() {
                    parts.push(format!("[Sticker: {}]({sticker_url})", sticker.name));
                }
            }
        }
    }

    let prefix = parts.join(" `|` ");
    let separator = if prefix.is_empty() { "" } else { " `|` " };

    let Some(content) = data.content.filter(|c| !c.is_empty()) else {
        return format!("{prefix}{}", code_block("Unknown content."));
    };

    let escaped = escape_code_block(content);

    if escaped.len() > 900 {
        let hastebin_url = crate::utils::hastebin(&escaped, "txt")
            .await
            .unwrap_or_else(|| "null".to_string());
        return format!("{prefix}{separator}[View full content]({hastebin_url})");
    }

    let max_content_len = (900usize).saturating_sub(prefix.len());
    format!(
        "{prefix}{}",
        code_block(&crate::utils::truncate(&escaped, max_content_len))
    )
}
