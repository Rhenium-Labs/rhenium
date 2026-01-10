import { CDN, Message, StickerType } from "discord.js";
import { PassThrough } from "stream";

import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";

import Logger from "./Logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export enum Extensions {
	PNG = "png",
	JPEG = "jpeg",
	JPG = "jpg",
	GIF = "gif",
	WEBP = "webp",
	BMP = "bmp",
	AVI = "avi",
	MP4 = "mp4",
	MOV = "mov",
	WEBM = "webm",
	JFIF = "jfif"
}

export interface MessageMediaMetadata {
	url?: string;
	base64?: string;
	buffer?: Uint8Array;
	extension?: Extensions;
}

export interface MessageMedia {
	emojis?: MessageMediaMetadata[];
	stickers?: MessageMediaMetadata[];
	attachments?: MessageMediaMetadata[];
	embeds?: MessageMediaMetadata[];
}

export interface SupportedMimeType {
	mime: string;
	extension: Extensions;
	pattern: number[];
	mask: number[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const CUSTOM_EMOJI_REGEX: Readonly<RegExp> = /<a?:(?<name>[a-zA-Z0-9_]+):(?<id>\d{17,19})>/g;

export const SUPPORTED_MIME_TYPES: Readonly<SupportedMimeType[]> = [
	{
		mime: "image/jpeg",
		extension: Extensions.JPEG,
		pattern: [0xff, 0xd8, 0xff],
		mask: [0xff, 0xff, 0xff]
	},
	{
		mime: "image/jpeg",
		extension: Extensions.JFIF,
		pattern: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00],
		mask: [0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
	},
	{
		mime: "image/png",
		extension: Extensions.PNG,
		pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		mask: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]
	},
	{
		mime: "image/bmp",
		extension: Extensions.BMP,
		pattern: [0x42, 0x4d],
		mask: [0xff, 0xff]
	},
	{
		mime: "image/gif",
		extension: Extensions.GIF,
		pattern: [0x47, 0x49, 0x46, 0x38],
		mask: [0xff, 0xff, 0xff, 0xff]
	},
	{
		mime: "image/webp",
		extension: Extensions.WEBP,
		pattern: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
		mask: [0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]
	},
	{
		mime: "video/webm",
		extension: Extensions.WEBM,
		pattern: [0x1a, 0x45, 0xdf, 0xa3],
		mask: [0xff, 0xff, 0xff, 0xff]
	},
	{
		mime: "video/x-msvideo",
		extension: Extensions.AVI,
		pattern: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20],
		mask: [0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]
	},
	{
		mime: "video/mp4",
		extension: Extensions.MP4,
		pattern: [0x66, 0x74, 0x79, 0x70],
		mask: [0xff, 0xff, 0xff, 0xff]
	},
	{
		mime: "video/quicktime",
		extension: Extensions.MOV,
		pattern: [0x6d, 0x6f, 0x6f, 0x76],
		mask: [0xff, 0xff, 0xff, 0xff]
	}
];

// ─────────────────────────────────────────────────────────────────────────────
// MediaUtils Class
// ─────────────────────────────────────────────────────────────────────────────

export class MediaUtils {
	/**
	 * Serialize custom emojis from a message.
	 */
	static async serializeEmojis(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const serializedEmojis: MessageMediaMetadata[] = [];
		const emojis = [...message.content.matchAll(CUSTOM_EMOJI_REGEX)];

		for (const emoji of emojis) {
			if (!emoji.groups) continue;

			const url = new CDN().emoji(emoji.groups.id);
			if (options.validate) {
				const metadata = await this._getMediaMetadata(url);
				if (metadata) serializedEmojis.push(metadata);
			} else {
				serializedEmojis.push({ url });
			}
		}

		return serializedEmojis.length ? serializedEmojis : null;
	}

	/**
	 * Serialize stickers from a message.
	 */
	static async serializeStickers(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const serializedStickers: MessageMediaMetadata[] = [];

		for (const sticker of message.stickers.values()) {
			if (sticker.type === StickerType.Standard) continue;

			const url = sticker.url;
			if (options.validate) {
				const metadata = await this._getMediaMetadata(url);
				if (metadata) serializedStickers.push(metadata);
			} else {
				serializedStickers.push({ url });
			}
		}

		return serializedStickers.length ? serializedStickers : null;
	}

	/**
	 * Serialize embeds from a message.
	 */
	static async serializeEmbeds(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const serializedEmbeds: MessageMediaMetadata[] = [];

		for (const embed of message.embeds) {
			if (embed.data.url || embed.data.thumbnail?.url) {
				let url: string | undefined = undefined;
				let metadata: MessageMediaMetadata | null = null;

				if (embed.data.url) url = embed.data.url;
				else if (embed.data.thumbnail?.url) url = embed.data.thumbnail.url;

				if (url) {
					if (options.validate) {
						metadata = await this._getMediaMetadata(url);
						if (metadata) serializedEmbeds.push(metadata);
					} else {
						serializedEmbeds.push({ url });
					}
				}
			}
		}

		return serializedEmbeds.length ? serializedEmbeds : null;
	}

	/**
	 * Serialize attachments from a message.
	 */
	static async serializeAttachments(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const serializedAttachments: MessageMediaMetadata[] = [];

		for (const attachment of message.attachments.values()) {
			const url = attachment.url;
			if (options.validate) {
				const metadata = await this._getMediaMetadata(url);
				if (metadata) serializedAttachments.push(metadata);
			} else {
				serializedAttachments.push({ url });
			}
		}

		return serializedAttachments.length ? serializedAttachments : null;
	}

	/**
	 * Serialize all media from a message.
	 */
	static async serializeMedia(message: Message, options: { validate: boolean }): Promise<MessageMedia | null> {
		const [emojis, stickers, attachments, embeds] = await Promise.all([
			this.serializeEmojis(message, options),
			this.serializeStickers(message, options),
			this.serializeAttachments(message, options),
			this.serializeEmbeds(message, options)
		]);

		if (!emojis && !stickers && !attachments && !embeds) {
			return null;
		}

		return {
			emojis: emojis ?? undefined,
			stickers: stickers ?? undefined,
			attachments: attachments ?? undefined,
			embeds: embeds ?? undefined
		};
	}

	/**
	 * Retrieve all media items as a flat array.
	 */
	static retrieveMedia(media: MessageMedia): MessageMediaMetadata[] {
		const allMedia: MessageMediaMetadata[] = [];

		if (media.emojis) allMedia.push(...media.emojis);
		if (media.stickers) allMedia.push(...media.stickers);
		if (media.attachments) allMedia.push(...media.attachments);
		if (media.embeds) allMedia.push(...media.embeds);

		return allMedia;
	}

	/**
	 * Process media for scanning (convert to PNG frames).
	 */
	static async processMedia(media: MessageMediaMetadata[]): Promise<MessageMediaMetadata[]> {
		const processedMedia: MessageMediaMetadata[] = [];

		for (const metadata of media) {
			try {
				if (!metadata.buffer || !metadata.extension) continue;
				const convertedMedia = await this.mediaConversion(metadata.buffer, metadata.extension);
				processedMedia.push(...convertedMedia);
			} catch (error) {
				Logger.error("Failed to process media:", error);
			}
		}

		return processedMedia;
	}

	/**
	 * Convert media to PNG format for scanning.
	 */
	static async mediaConversion(buffer: Uint8Array, format: Extensions): Promise<MessageMediaMetadata[]> {
		switch (format) {
			case Extensions.MP4:
			case Extensions.AVI:
			case Extensions.MOV:
			case Extensions.WEBM:
				return await this._getVideoPngFrames(buffer, format);
			case Extensions.GIF:
				return await this._getGifPngFrames(buffer);
			case Extensions.WEBP:
				return await this._convertWebpToPng(buffer);
			case Extensions.BMP:
			case Extensions.JFIF:
				return await this._convertToPng(buffer);
			default: {
				const resized = await this._resizeAndCompressPng(Buffer.from(buffer));
				return [{ base64: resized.toString("base64"), extension: Extensions.PNG }];
			}
		}
	}

	/**
	 * Serialize multi-modal input for OpenAI moderation.
	 */
	static serializeMultiModalInput(
		content: MessageMediaMetadata[]
	): Array<{ type: "image_url"; image_url: { url: string } }> {
		return content.map(metadata => ({
			type: "image_url" as const,
			image_url: { url: `data:image/${metadata.extension};base64,${metadata.base64}` }
		}));
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Private Helpers
	// ─────────────────────────────────────────────────────────────────────────

	private static async _getMediaMetadata(url: string): Promise<MessageMediaMetadata | null> {
		try {
			const response = await fetch(url);
			const buffer = await response.arrayBuffer();
			const fileSignature = new Uint8Array(buffer.slice(0, 12));
			const contentType = response.headers.get("content-type");
			const extension = this._getExtension(fileSignature, contentType);

			if (extension) {
				return {
					url,
					buffer: new Uint8Array(buffer),
					extension
				};
			}
		} catch (error) {
			Logger.error("Failed to retrieve media metadata:", error);
		}
		return null;
	}

	private static _getExtension(fileSignature: Uint8Array, contentType: string | null): Extensions | null {
		const relevantMimeTypes = SUPPORTED_MIME_TYPES.filter(({ mime }) => mime === contentType);

		return (
			this._deepMimeValidation(fileSignature, relevantMimeTypes) ??
			this._deepMimeValidation(fileSignature, SUPPORTED_MIME_TYPES)
		);
	}

	private static _deepMimeValidation(
		fileSignature: Uint8Array,
		mimeTypes: readonly SupportedMimeType[]
	): Extensions | null {
		for (const { pattern, mask, extension } of mimeTypes) {
			const patLen = pattern.length;
			for (let offset = 0; offset + patLen <= fileSignature.length; offset++) {
				let isMatch = true;
				for (let i = 0; i < patLen; i++) {
					if ((fileSignature[offset + i] & mask[i]) !== (pattern[i] & mask[i])) {
						isMatch = false;
						break;
					}
				}
				if (isMatch) return extension;
			}
		}
		return null;
	}

	private static async _resizeAndCompressPng(buffer: Buffer, maxSize = 512): Promise<Buffer> {
		return await sharp(buffer)
			.resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
			.png({ compressionLevel: 9, quality: 80 })
			.toBuffer();
	}

	private static async _convertToPng(buffer: Uint8Array): Promise<MessageMediaMetadata[]> {
		return new Promise(async (resolve, reject) => {
			const inputStream = new PassThrough();
			inputStream.end(buffer);

			const outputStream = new PassThrough();
			const chunks: Buffer[] = [];

			ffmpeg(inputStream)
				.inputFormat("image2pipe")
				.outputOptions("-f", "image2pipe", "-vcodec", "png")
				.on("error", () => {
					reject(new Error("Failed to convert image to PNG"));
				})
				.on("end", async () => {
					try {
						const resized = await this._resizeAndCompressPng(Buffer.concat(chunks));
						resolve([{ base64: resized.toString("base64"), extension: Extensions.PNG }]);
					} catch (err) {
						reject(err);
					}
				})
				.pipe(outputStream, { end: true });

			outputStream.on("data", chunk => {
				chunks.push(chunk);
			});

			outputStream.on("error", () => {
				reject(new Error("Failed to write to output stream"));
			});
		});
	}

	private static async _convertWebpToPng(buffer: Uint8Array): Promise<MessageMediaMetadata[]> {
		const metadata = await sharp(buffer).metadata();
		const frames: MessageMediaMetadata[] = [];

		if (metadata.pages && metadata.pages > 1) {
			const middleFrameIndex = Math.floor(metadata.pages / 2);

			const first = await sharp(buffer, { page: 0 }).png().toBuffer();
			const middle = await sharp(buffer, { page: middleFrameIndex }).png().toBuffer();

			frames.push({
				base64: (await this._resizeAndCompressPng(first)).toString("base64"),
				extension: Extensions.PNG
			});
			frames.push({
				base64: (await this._resizeAndCompressPng(middle)).toString("base64"),
				extension: Extensions.PNG
			});

			return frames;
		} else {
			const pngBuffer = await sharp(buffer).png().toBuffer();
			frames.push({
				base64: (await this._resizeAndCompressPng(pngBuffer)).toString("base64"),
				extension: Extensions.PNG
			});

			return frames;
		}
	}

	private static async _getGifPngFrames(buffer: Uint8Array): Promise<MessageMediaMetadata[]> {
		try {
			const metadata = await sharp(buffer).metadata();
			const frames: MessageMediaMetadata[] = [];

			if (metadata.pages && metadata.pages > 1) {
				const middleFrameIndex = Math.floor(metadata.pages / 2);

				const first = await sharp(buffer, { page: 0 }).png().toBuffer();
				const middle = await sharp(buffer, { page: middleFrameIndex }).png().toBuffer();

				frames.push({
					base64: (await this._resizeAndCompressPng(first)).toString("base64"),
					extension: Extensions.PNG
				});
				frames.push({
					base64: (await this._resizeAndCompressPng(middle)).toString("base64"),
					extension: Extensions.PNG
				});
			} else {
				const pngBuffer = await sharp(buffer).png().toBuffer();
				frames.push({
					base64: (await this._resizeAndCompressPng(pngBuffer)).toString("base64"),
					extension: Extensions.PNG
				});
			}

			return frames;
		} catch (error) {
			// Fallback for problematic GIFs
			const pngBuffer = await sharp(buffer).png().toBuffer();
			return [
				{
					base64: (await this._resizeAndCompressPng(pngBuffer)).toString("base64"),
					extension: Extensions.PNG
				}
			];
		}
	}

	private static async _getVideoDuration(buffer: Uint8Array): Promise<number | null> {
		return new Promise((resolve, reject) => {
			const stream = new PassThrough();
			stream.end(buffer);

			ffmpeg(stream).ffprobe((err, metadata) => {
				if (err) {
					return reject(new Error(`Error getting video metadata: ${err.message}`));
				}
				resolve(metadata.format.duration ?? null);
			});
		});
	}

	private static async _getVideoPngFrame(
		buffer: Uint8Array,
		format: Extensions,
		timestamp: number
	): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			const stream = new PassThrough();
			stream.end(buffer);

			const outputStream = new PassThrough();
			const chunks: Buffer[] = [];

			ffmpeg(stream)
				.inputFormat(format)
				.seekInput(timestamp)
				.frames(1)
				.outputOptions("-f", "image2pipe", "-vcodec", "png")
				.on("error", err => {
					reject(new Error(`Error during conversion: ${err.message}`));
				})
				.on("end", () => {
					resolve(Buffer.concat(chunks));
				})
				.pipe(outputStream, { end: true });

			outputStream.on("data", chunk => {
				chunks.push(chunk);
			});

			outputStream.on("error", err => {
				reject(new Error(`Error in output stream: ${err.message}`));
			});
		});
	}

	private static async _getVideoPngFrames(buffer: Uint8Array, format: Extensions): Promise<MessageMediaMetadata[]> {
		const frameBuffers: MessageMediaMetadata[] = [];

		try {
			const duration = await this._getVideoDuration(buffer);
			if (!duration) return frameBuffers;

			const timestamps = [0, duration / 2];

			for (const timestamp of timestamps) {
				const frameBuffer = await this._getVideoPngFrame(buffer, format, timestamp);
				const resized = await this._resizeAndCompressPng(frameBuffer);
				frameBuffers.push({ base64: resized.toString("base64"), extension: Extensions.PNG });
			}
		} catch {
			// Return empty on failure
		}

		return frameBuffers;
	}
}

export default MediaUtils;
