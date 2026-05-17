use base64::Engine;
use image::GenericImageView;
use regex::Regex;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time;
use tracing::warn;

const MEDIA_PROCESS_TIMEOUT: Duration = Duration::from_secs(15);
const OCR_PROCESS_TIMEOUT: Duration = Duration::from_secs(20);

/// Supported file extensions for media processing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MediaExtension {
    Png,
    Jpeg,
    #[allow(dead_code)]
    Jpg,
    Gif,
    Webp,
    Bmp,
    Avi,
    Mp4,
    Mov,
    Webm,
    Jfif,
}

impl MediaExtension {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpeg",
            Self::Jpg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
            Self::Bmp => "bmp",
            Self::Avi => "avi",
            Self::Mp4 => "mp4",
            Self::Mov => "mov",
            Self::Webm => "webm",
            Self::Jfif => "jfif",
        }
    }

    #[allow(dead_code)]
    pub fn is_video(&self) -> bool {
        matches!(self, Self::Mp4 | Self::Avi | Self::Mov | Self::Webm)
    }

    #[allow(dead_code)]
    pub fn is_animated_image(&self) -> bool {
        matches!(self, Self::Gif | Self::Webp)
    }
}

/// Metadata for a processed media item.
#[derive(Debug, Clone)]
pub struct MediaMetadata {
    pub url: Option<String>,
    pub base64: Option<String>,
    pub buffer: Option<Vec<u8>>,
    pub extension: Option<MediaExtension>,
}

/// Collection of all media types found in a message.
#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct MessageMedia {
    pub emojis: Vec<MediaMetadata>,
    pub stickers: Vec<MediaMetadata>,
    pub attachments: Vec<MediaMetadata>,
    pub embeds: Vec<MediaMetadata>,
}

#[allow(dead_code)]
impl MessageMedia {
    pub fn is_empty(&self) -> bool {
        self.emojis.is_empty()
            && self.stickers.is_empty()
            && self.attachments.is_empty()
            && self.embeds.is_empty()
    }

    /// Flatten all media items into a single array.
    pub fn all_items(&self) -> Vec<&MediaMetadata> {
        self.emojis
            .iter()
            .chain(self.stickers.iter())
            .chain(self.attachments.iter())
            .chain(self.embeds.iter())
            .collect()
    }
}

/// MIME type signature for binary validation.
struct MimeSignature {
    mime: &'static str,
    extension: MediaExtension,
    pattern: &'static [u8],
    mask: &'static [u8],
}

const SUPPORTED_MIME_TYPES: &[MimeSignature] = &[
    // JPEG — basic SOI marker (3 bytes).
    MimeSignature {
        mime: "image/jpeg",
        extension: MediaExtension::Jpeg,
        pattern: &[0xff, 0xd8, 0xff],
        mask: &[0xff, 0xff, 0xff],
    },
    // JFIF — JPEG with JFIF APP0 marker (11 bytes, 5th byte is length and masked out).
    MimeSignature {
        mime: "image/jpeg",
        extension: MediaExtension::Jfif,
        pattern: &[0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00],
        mask: &[0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    },
    MimeSignature {
        mime: "image/png",
        extension: MediaExtension::Png,
        pattern: &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        mask: &[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    },
    MimeSignature {
        mime: "image/bmp",
        extension: MediaExtension::Bmp,
        pattern: &[0x42, 0x4d],
        mask: &[0xff, 0xff],
    },
    MimeSignature {
        mime: "image/gif",
        extension: MediaExtension::Gif,
        pattern: &[0x47, 0x49, 0x46, 0x38],
        mask: &[0xff, 0xff, 0xff, 0xff],
    },
    MimeSignature {
        mime: "image/webp",
        extension: MediaExtension::Webp,
        pattern: &[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
        mask: &[0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff],
    },
    MimeSignature {
        mime: "video/webm",
        extension: MediaExtension::Webm,
        pattern: &[0x1a, 0x45, 0xdf, 0xa3],
        mask: &[0xff, 0xff, 0xff, 0xff],
    },
    // AVI — RIFF....AVI  (bytes 8-11 are the sub-type).
    MimeSignature {
        mime: "video/x-msvideo",
        extension: MediaExtension::Avi,
        pattern: &[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20],
        mask: &[0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff],
    },
    MimeSignature {
        mime: "video/mp4",
        extension: MediaExtension::Mp4,
        pattern: &[0x66, 0x74, 0x79, 0x70],
        mask: &[0xff, 0xff, 0xff, 0xff],
    },
    // QuickTime MOV — `moov` atom.
    MimeSignature {
        mime: "video/quicktime",
        extension: MediaExtension::Mov,
        pattern: &[0x6d, 0x6f, 0x6f, 0x76],
        mask: &[0xff, 0xff, 0xff, 0xff],
    },
];

/// Determines file extension from binary file signature.
///
/// pure signature-based detection.  The TS implementation uses the first 12 bytes as the
/// signature slice (same as here), but does NOT require the file to be at least 12 bytes —
/// `matches_signature` already guards for `sig.len() < pattern.len()`.
fn detect_extension(data: &[u8], content_type: Option<&str>) -> Option<MediaExtension> {
    if data.is_empty() {
        return None;
    }

    let sig = &data[..12.min(data.len())];

    // Try content-type match first.
    if let Some(ct) = content_type {
        for mime_type in SUPPORTED_MIME_TYPES {
            if mime_type.mime == ct && matches_signature(sig, mime_type) {
                return Some(mime_type.extension);
            }
        }
    }

    // Fall back to signature-based detection.
    for mime_type in SUPPORTED_MIME_TYPES {
        if matches_signature(sig, mime_type) {
            return Some(mime_type.extension);
        }
    }

    None
}

fn matches_signature(sig: &[u8], mime: &MimeSignature) -> bool {
    if sig.len() < mime.pattern.len() {
        return false;
    }
    for (i, byte) in sig.iter().enumerate().take(mime.pattern.len()) {
        if (byte & mime.mask[i]) != (mime.pattern[i] & mime.mask[i]) {
            return false;
        }
    }
    true
}

/// Fetch media from a URL, validate its type, and return metadata.
pub async fn fetch_media_metadata(http_client: &reqwest::Client, url: &str) -> Option<MediaMetadata> {
    let response = http_client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = response.bytes().await.ok()?;
    let extension = detect_extension(&bytes, content_type.as_deref())?;

    Some(MediaMetadata {
        url: Some(url.to_string()),
        buffer: Some(bytes.to_vec()),
        base64: None,
        extension: Some(extension),
    })
}

/// Serialize custom emojis from message content.
///
/// Mirrors TS `serializeEmojis`, which calls `new CDN().emoji(id)` without options.
/// Discord.js defaults that URL to `.webp` for both static and animated custom emojis.
pub async fn serialize_emojis(http_client: &reqwest::Client, content: &str) -> Vec<MediaMetadata> {
    // Capture group 1: optional 'a' for animated; group 2: name; group 3: id.
    let Ok(re) = Regex::new(r"<(a?):([a-zA-Z0-9_]+):(\d{17,19})>") else {
        return Vec::new();
    };
    let mut results = Vec::new();

    for cap in re.captures_iter(content) {
        if let Some(id) = cap.get(3) {
            let url = format!("https://cdn.discordapp.com/emojis/{}.webp", id.as_str());
            if let Some(meta) = fetch_media_metadata(http_client, &url).await {
                results.push(meta);
            }
        }
    }

    results
}

/// Resize and compress an image buffer to PNG, max 512x512.
pub fn resize_and_compress_png(data: &[u8], max_size: u32) -> Option<Vec<u8>> {
    let img = image::load_from_memory(data).ok()?;
    let (w, h) = img.dimensions();

    let resized = if w > max_size || h > max_size {
        img.resize(max_size, max_size, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    resized
        .write_with_encoder(encoder)
        .ok()?;

    Some(buf)
}

/// Convert media to base64 PNG frames for OpenAI input.
pub async fn process_media_for_scan(items: Vec<MediaMetadata>) -> Vec<MediaMetadata> {
    let mut result = Vec::new();

    for item in items {
        let Some(buffer) = &item.buffer else {
            continue;
        };
        let Some(ext) = &item.extension else {
            continue;
        };

        match ext {
            MediaExtension::Mp4 | MediaExtension::Avi | MediaExtension::Mov | MediaExtension::Webm => {
                if let Some(frames) = extract_video_frames(buffer, ext.as_str()).await {
                    result.extend(frames);
                }
            }
            MediaExtension::Gif | MediaExtension::Webp => {
                // Mirror TS _processAnimatedImage: extract first frame and, for multi-frame
                // animated images, also extract the middle frame.
                let frames = extract_animated_image_frames(buffer);
                result.extend(frames);
            }
            _ => {
                // Static images.
                if let Some(png) = resize_and_compress_png(buffer, 512) {
                    result.push(MediaMetadata {
                        url: None,
                        buffer: None,
                        base64: Some(base64::engine::general_purpose::STANDARD.encode(&png)),
                        extension: Some(MediaExtension::Png),
                    });
                }
            }
        }
    }

    result
}

/// Extract frames from an animated image (GIF or WebP).
///
/// Mirrors TS `_processAnimatedImage`:
/// - For images with more than one page/frame: extract the first frame (index 0)
///   and the middle frame (index pages / 2).
/// - For single-frame images: extract only the first frame.
///
/// The `image` crate does not expose multi-frame GIF/WebP decoding with arbitrary
/// page selection via a stable public API, so this implementation decodes the
/// entire image (which yields the first frame) and falls back to a single-frame
/// result.  Where ffmpeg is available, a two-frame extraction via the subprocess
/// path would be more accurate, but the `image` crate is the only guaranteed
/// for animated content and silently produce one when the second cannot be decoded.
fn extract_animated_image_frames(data: &[u8]) -> Vec<MediaMetadata> {
    // Attempt to decode as a GIF to count frames and extract them.
    // `image` 0.25 supports multi-frame GIF decoding via `image::codecs::gif`.
    use image::AnimationDecoder as _;

    fn frame_to_metadata(frame: &image::Frame) -> Option<MediaMetadata> {
        use image::ImageEncoder as _;
        let rgba = frame.buffer();
        let (w, h) = (rgba.width(), rgba.height());
        let mut raw_png: Vec<u8> = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut raw_png);
        encoder
            .write_image(rgba.as_raw(), w, h, image::ExtendedColorType::Rgba8)
            .ok()?;
        let png = resize_and_compress_png(&raw_png, 512)?;
        Some(MediaMetadata {
            url: None,
            buffer: None,
            base64: Some(base64::engine::general_purpose::STANDARD.encode(&png)),
            extension: Some(MediaExtension::Png),
        })
    }

    let gif_result: Option<Vec<MediaMetadata>> = (|| {
        let cursor = std::io::Cursor::new(data);
        let decoder = image::codecs::gif::GifDecoder::new(cursor).ok()?;
        let frames: Vec<image::Frame> = decoder.into_frames().collect_frames().ok()?;
        if frames.is_empty() {
            return None;
        }

        let indices: Vec<usize> = if frames.len() > 1 {
            vec![0, frames.len() / 2]
        } else {
            vec![0]
        };

        let result: Vec<MediaMetadata> = indices
            .into_iter()
            .filter_map(|idx| frames.get(idx).and_then(frame_to_metadata))
            .collect();

        if result.is_empty() { None } else { Some(result) }
    })();

    if let Some(frames) = gif_result {
        return frames;
    }

    // Fallback: decode as a static image (covers WebP and degenerate GIFs).
    if let Some(png) = resize_and_compress_png(data, 512) {
        vec![MediaMetadata {
            url: None,
            buffer: None,
            base64: Some(base64::engine::general_purpose::STANDARD.encode(&png)),
            extension: Some(MediaExtension::Png),
        }]
    } else {
        Vec::new()
    }
}

/// Extract key frames from a video using FFmpeg.
async fn extract_video_frames(data: &[u8], format: &str) -> Option<Vec<MediaMetadata>> {
    let mut frames = Vec::new();

    // Get duration via ffprobe.
    let duration = get_video_duration(data).await?;

    let timestamps = vec![0.0, duration / 2.0];

    for ts in timestamps {
        if let Some(frame) = extract_single_frame(data, format, ts).await {
            if let Some(png) = resize_and_compress_png(&frame, 512) {
                frames.push(MediaMetadata {
                    url: None,
                    buffer: None,
                    base64: Some(base64::engine::general_purpose::STANDARD.encode(&png)),
                    extension: Some(MediaExtension::Png),
                });
            }
        }
    }

    if frames.is_empty() {
        None
    } else {
        Some(frames)
    }
}

/// Get video duration using ffprobe.
async fn get_video_duration(data: &[u8]) -> Option<f64> {
    let mut child = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            "-i", "pipe:0",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;

    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        if let Err(err) = stdin.write_all(data).await {
            warn!("Failed to write media data to ffprobe: {err}");
            return None;
        }
        drop(stdin);
    }

    let output = match time::timeout(MEDIA_PROCESS_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            warn!("ffprobe failed while reading media duration: {err}");
            return None;
        }
        Err(_) => {
            warn!("ffprobe timed out while reading media duration");
            return None;
        }
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.trim().parse::<f64>().ok()
}

/// Extract a single PNG frame at a given timestamp using ffmpeg.
async fn extract_single_frame(data: &[u8], _format: &str, timestamp: f64) -> Option<Vec<u8>> {
    let mut child = Command::new("ffmpeg")
        .args([
            "-ss", &format!("{timestamp}"),
            "-i", "pipe:0",
            "-frames:v", "1",
            "-f", "image2pipe",
            "-vcodec", "png",
            "pipe:1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()?;

    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        if let Err(err) = stdin.write_all(data).await {
            warn!("Failed to write media data to ffmpeg: {err}");
            return None;
        }
        drop(stdin);
    }

    let output = match time::timeout(MEDIA_PROCESS_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => {
            warn!("ffmpeg failed while extracting media frame: {err}");
            return None;
        }
        Err(_) => {
            warn!("ffmpeg timed out while extracting media frame");
            return None;
        }
    };

    if output.status.success() && !output.stdout.is_empty() {
        Some(output.stdout)
    } else {
        None
    }
}

/// Run Tesseract OCR on an image buffer.
///
/// Returns:
/// - `Ok(Some(text))` — OCR succeeded and found text
/// - `Ok(None)`       — OCR succeeded but the image had no readable text
/// - `Err(())`        — OCR process failed (spawn error, timeout, non-zero exit)
///
/// Callers must distinguish Ok(None) from Err(()) to avoid counting "no text found"
/// as a frame failure, matching TS behaviour where only null (crash) increments frameFailures.
pub async fn run_ocr(image_data: &[u8]) -> Result<Option<String>, ()> {
    let mut child = Command::new("tesseract")
        .args(["stdin", "stdout", "-l", "eng"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| ())?;

    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        if stdin.write_all(image_data).await.is_err() {
            return Err(());
        }
        drop(stdin);
    }

    let output = match time::timeout(OCR_PROCESS_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        _ => return Err(()),
    };

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if text.is_empty() { None } else { Some(text) })
    } else {
        Err(())
    }
}

/// Serialize media metadata for OpenAI multi-modal input.
pub fn serialize_multimodal_input(
    items: &[MediaMetadata],
) -> Vec<serde_json::Value> {
    items
        .iter()
        .filter_map(|item| {
            let base64 = item.base64.as_ref()?;
            let ext = item.extension.as_ref()?.as_str();

            Some(serde_json::json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:image/{ext};base64,{base64}")
                }
            }))
        })
        .collect()
}
