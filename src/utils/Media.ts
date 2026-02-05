import { CDN, Message, StickerType } from "discord.js";
import { PassThrough } from "stream";

import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";

import { DISCORD_EMOJI_REGEX_GLOBAL } from "./Constants.js";

import Logger from "./Logger.js";

export default class MediaUtils {
	/**
	 * Serialize custom emojis from a message.
	 *
	 * @param message The Discord message to parse.
	 * @param options Validation options.
	 * @returns A list of serialized emoji media metadata, or null if none found.
	 */
	static async serializeEmojis(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const emojis = [...message.content.matchAll(DISCORD_EMOJI_REGEX_GLOBAL)];
		const serialized = await Promise.all(
			emojis
				.filter(emoji => emoji.groups?.id)
				.map(emoji => this._processMediaUrl(new CDN().emoji(emoji.groups!.id), options))
		);

		const valid = serialized.filter((item): item is MessageMediaMetadata => item !== null);
		return valid.length ? valid : null;
	}

	/**
	 * Serialize stickers from a message.
	 *
	 * @param message The Discord message to parse.
	 * @param options Validation options.\
	 * @returns A list of serialized sticker media metadata, or null if none found.
	 */
	static async serializeStickers(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const stickers = [...message.stickers.values()].filter(
			sticker => sticker.type !== StickerType.Standard
		);

		const serialized = await Promise.all(
			stickers.map(sticker => this._processMediaUrl(sticker.url, options))
		);

		const valid = serialized.filter((item): item is MessageMediaMetadata => item !== null);
		return valid.length ? valid : null;
	}

	/**
	 * Serialize embeds from a message.
	 *
	 * @param message The Discord message to parse.
	 * @param options Validation options.
	 * @returns A list of serialized embed media metadata, or null if none found.
	 */
	static async serializeEmbeds(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const serialized = await Promise.all(
			message.embeds.map(embed => {
				const url = embed.data.url ?? embed.data.thumbnail?.url;
				if (!url) return null;

				return this._processMediaUrl(url, options);
			})
		);

		const valid = serialized.filter((item): item is MessageMediaMetadata => item !== null);
		return valid.length ? valid : null;
	}

	/**
	 * Serialize attachments from a message.
	 *
	 * @param message The Discord message to parse.
	 * @param options Validation options.
	 * @returns A list of serialized attachment media metadata, or null if none found.
	 */
	static async serializeAttachments(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata[] | null> {
		const serialized = await Promise.all(
			[...message.attachments.values()].map(attachment =>
				this._processMediaUrl(attachment.url, options)
			)
		);

		const valid = serialized.filter((item): item is MessageMediaMetadata => item !== null);
		return valid.length ? valid : null;
	}

	/**
	 * Serialize all media from a message (emojis, stickers, attachments, embeds).
	 *
	 * @param message The Discord message to scan.
	 * @param options Validation options.
	 * @returns A collection of all serialized media, or null if none found.
	 */
	static async serializeMedia(
		message: Message,
		options: { validate: boolean }
	): Promise<MessageMedia | null> {
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
	 * Flatten all media items into a single array.
	 *
	 * @param media The media collection to flatten.
	 * @returns An array of all media metadata items.
	 */
	static retrieveMedia(media: MessageMedia): MessageMediaMetadata[] {
		return [
			...(media.emojis ?? []),
			...(media.stickers ?? []),
			...(media.attachments ?? []),
			...(media.embeds ?? [])
		];
	}

	/**
	 * Process media items for scanning, converting them to PNG frames if necessary.
	 *
	 * @param media The list of media metadata to process.
	 * @returns A list of processed media metadata.
	 */
	static async processMedia(media: MessageMediaMetadata[]): Promise<MessageMediaMetadata[]> {
		const processedMedia: MessageMediaMetadata[] = [];

		await Promise.all(
			media.map(async metadata => {
				try {
					if (!metadata.buffer || !metadata.extension) return;
					const converted = await this.mediaConversion(
						metadata.buffer,
						metadata.extension
					);
					if (converted.length) processedMedia.push(...converted);
				} catch (error) {
					Logger.error("Failed to process media item:", error);
				}
			})
		);

		return processedMedia;
	}

	/**
	 * Convert various media formats to PNG.
	 * Handles video frame extraction and animated image frame extraction.
	 *
	 * @param buffer The input buffer.
	 * @param format The format of the input buffer.
	 * @returns A list of processed media metadata.
	 */
	static async mediaConversion(
		buffer: Uint8Array,
		format: Extensions
	): Promise<MessageMediaMetadata[]> {
		switch (format) {
			case Extensions.MP4:
			case Extensions.AVI:
			case Extensions.MOV:
			case Extensions.WEBM:
				return await this._getVideoPngFrames(buffer, format);
			case Extensions.GIF:
			case Extensions.WEBP:
				return await this._processAnimatedImage(buffer);
			case Extensions.BMP:
			case Extensions.JFIF:
				return await this._convertToPng(buffer);
			default: {
				// Default to simple resize/compress for single frame images.
				const resized = await this._resizeAndCompressPng(Buffer.from(buffer));
				return [{ base64: resized.toString("base64"), extension: Extensions.PNG }];
			}
		}
	}

	/**
	 * Serialize media metadata into a format suitable for OpenAI multi-modal input.
	 *
	 * @param content The processed media metadata.
	 * @returns An array formatted for OpenAI multi-modal input.
	 */
	static serializeMultiModalInput(
		content: MessageMediaMetadata[]
	): Array<{ type: "image_url"; image_url: { url: string } }> {
		return content.map(metadata => ({
			type: "image_url" as const,
			image_url: { url: `data:image/${metadata.extension};base64,${metadata.base64}` }
		}));
	}

	/** Helper to validate a URL and fetch its metadata if validation is required. */
	private static async _processMediaUrl(
		url: string,
		options: { validate: boolean }
	): Promise<MessageMediaMetadata | null> {
		if (options.validate) return this._getMediaMetadata(url);
		return { url };
	}

	/** Fetches media metadata from a URL, including binary signature validation. */
	private static async _getMediaMetadata(url: string): Promise<MessageMediaMetadata | null> {
		try {
			const response = await fetch(url);
			if (!response.ok) return null;

			const arrayBuffer = await response.arrayBuffer();
			const buffer = new Uint8Array(arrayBuffer);
			const fileSignature = buffer.slice(0, 12);
			const contentType = response.headers.get("content-type");
			const extension = this._getExtension(fileSignature, contentType);

			if (extension) {
				return {
					url,
					buffer,
					extension
				};
			}
		} catch (error) {
			Logger.error("Failed to retrieve media metadata:", error);
		}

		return null;
	}

	/** Determines the file extension based on the file signature and content type. */
	private static _getExtension(
		fileSignature: Uint8Array,
		contentType: string | null
	): Extensions | null {
		const relevantMimeTypes = SUPPORTED_MIME_TYPES.filter(({ mime }) => mime === contentType);

		return (
			this._deepMimeValidation(fileSignature, relevantMimeTypes) ??
			this._deepMimeValidation(fileSignature, SUPPORTED_MIME_TYPES)
		);
	}

	/** Performs deep validation of the file signature against known MIME type patterns. */
	private static _deepMimeValidation(
		fileSignature: Uint8Array,
		mimeTypes: readonly SupportedMimeType[]
	): Extensions | null {
		for (const { pattern, mask, extension } of mimeTypes) {
			if (fileSignature.length < pattern.length) continue;

			let isMatch = true;
			// A simple loop is often faster than creating new arrays/slices for every check.
			for (let i = 0; i < pattern.length; i++) {
				if ((fileSignature[i] & mask[i]) !== (pattern[i] & mask[i])) {
					isMatch = false;
					break;
				}
			}
			if (isMatch) return extension;
		}
		return null;
	}

	/** Resize and compress a PNG buffer to fit within max dimensions. */
	private static async _resizeAndCompressPng(buffer: Buffer, maxSize = 512): Promise<Buffer> {
		return await sharp(buffer)
			.resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
			.png({ compressionLevel: 9, quality: 80 })
			.toBuffer();
	}

	/** Converts various image formats to PNG. */
	private static async _convertToPng(buffer: Uint8Array): Promise<MessageMediaMetadata[]> {
		return new Promise((resolve, reject) => {
			const inputStream = new PassThrough();
			inputStream.end(buffer);

			const outputStream = new PassThrough();
			const chunks: Buffer[] = [];

			ffmpeg(inputStream)
				.inputFormat("image2pipe")
				.outputOptions("-f", "image2pipe", "-vcodec", "png")
				.on("error", err =>
					reject(new Error(`FFmpeg conversion failed: ${err.message}`))
				)
				.on("end", async () => {
					try {
						const resized = await this._resizeAndCompressPng(
							Buffer.concat(chunks)
						);
						resolve([
							{ base64: resized.toString("base64"), extension: Extensions.PNG }
						]);
					} catch (err) {
						reject(err);
					}
				})
				.pipe(outputStream, { end: true });

			outputStream.on("data", chunk => chunks.push(chunk));
			outputStream.on("error", err =>
				reject(new Error(`Output stream error: ${err.message}`))
			);
		});
	}

	/** Processes animated images (GIF, WebP) to extract key frames as PNGs. */
	private static async _processAnimatedImage(
		buffer: Uint8Array
	): Promise<MessageMediaMetadata[]> {
		try {
			const metadata = await sharp(buffer).metadata();
			const pages = metadata.pages || 0;
			const frames: MessageMediaMetadata[] = [];

			const extractAndPush = async (page: number) => {
				const pngBuffer = await sharp(buffer, { page }).png().toBuffer();
				const resized = await this._resizeAndCompressPng(pngBuffer);
				frames.push({
					base64: resized.toString("base64"),
					extension: Extensions.PNG
				});
			};

			if (pages > 1) {
				const middleFrameIndex = Math.floor(pages / 2);
				await Promise.all([extractAndPush(0), extractAndPush(middleFrameIndex)]);
			} else {
				await extractAndPush(0);
			}

			return frames;
		} catch (error) {
			const pngBuffer = await sharp(buffer).png().toBuffer();
			const resized = await this._resizeAndCompressPng(pngBuffer);

			return [{ base64: resized.toString("base64"), extension: Extensions.PNG }];
		}
	}

	/** Extracts PNG frames from a video buffer at specified timestamps. */
	private static async _getVideoDuration(buffer: Uint8Array): Promise<number | null> {
		return new Promise((resolve, reject) => {
			const stream = new PassThrough();
			stream.end(buffer);

			ffmpeg(stream).ffprobe((err, metadata) => {
				if (err)
					return reject(new Error(`Error getting video metadata: ${err.message}`));
				resolve(metadata.format.duration ?? null);
			});
		});
	}

	/** Extracts a single PNG frame from a video buffer at a specific timestamp. */
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
				.on("error", err =>
					reject(new Error(`Error during frame extraction: ${err.message}`))
				)
				.on("end", () => resolve(Buffer.concat(chunks)))
				.pipe(outputStream, { end: true });

			outputStream.on("data", chunk => chunks.push(chunk));
			outputStream.on("error", err =>
				reject(new Error(`Output stream error: ${err.message}`))
			);
		});
	}

	/** Extracts key PNG frames from a video buffer. */
	private static async _getVideoPngFrames(
		buffer: Uint8Array,
		format: Extensions
	): Promise<MessageMediaMetadata[]> {
		const frameBuffers: MessageMediaMetadata[] = [];

		try {
			const duration = await this._getVideoDuration(buffer);
			if (!duration) return frameBuffers;

			const timestamps = [0, duration / 2];

			for (const timestamp of timestamps) {
				const frameBuffer = await this._getVideoPngFrame(buffer, format, timestamp);
				const resized = await this._resizeAndCompressPng(frameBuffer);
				frameBuffers.push({
					base64: resized.toString("base64"),
					extension: Extensions.PNG
				});
			}
		} catch (error) {
			Logger.error("Error processing video frames:", error);
		}

		return frameBuffers;
	}
}

/** Supported file extensions for media processing. */
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

/** Metadata for a processed media item. */
export interface MessageMediaMetadata {
	url?: string;
	base64?: string;
	buffer?: Uint8Array;
	extension?: Extensions;
}

/** Collection of all media types found in a message. */
export interface MessageMedia {
	emojis?: MessageMediaMetadata[];
	stickers?: MessageMediaMetadata[];
	attachments?: MessageMediaMetadata[];
	embeds?: MessageMediaMetadata[];
}

/** Definition for supported MIME types and their binary signatures. */
export interface SupportedMimeType {
	mime: string;
	extension: Extensions;
	pattern: number[];
	mask: number[];
}

/** Supported MIME types and their binary signatures. */
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
