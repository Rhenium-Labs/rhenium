import {
	type TextBasedChannel,
	type MessageCreateOptions,
	type MessageEditOptions,
	type MessageReplyOptions,
	type PartialGroupDMChannel,
	type ReplyOptions,
	codeBlock,
	DiscordAPIError,
	escapeCodeBlock,
	hyperlink,
	Message,
	RESTJSONErrorCodes,
	StickerFormatType,
	cleanContent as djsCleanContent,
	MessagePayload
} from "discord.js";

import { client } from "#root/index.js";
import { hastebin, truncate } from "./index.js";

type MessageOptions = MessageCreateOptions | MessageReplyOptions | MessageEditOptions;

const replies: WeakMap<Message, Message> = new WeakMap();

/**
 * Sends a message as a response for `message`, and tracks it.
 *
 * @param message The message to replies to.
 * @param options The options for the message sending, identical to `TextBasedChannel#send`'s options.
 * @returns The response message.
 */
export function send(message: Message, options: string | MessageOptions): Promise<Message> {
	return handle(message, options);
}

/**
 * Sends a reply message as a response for `message`, and tracks it.
 *
 * @param message The message to replies to.
 * @param options The options for the message sending, identical to `TextBasedChannel#send`'s options.
 * @returns The response message.
 */
export function reply(message: Message, options: string | MessageOptions): Promise<Message> {
	const replyOptions: ReplyOptions =
		typeof options === "string"
			? {
					messageReference: message,
					failIfNotExists: message.client.options.failIfNotExists
				}
			: {
					messageReference: message,
					failIfNotExists:
						Reflect.get(options, "failIfNotExists") ??
						message.client.options.failIfNotExists
				};

	return handle(message, options, { reply: replyOptions });
}

async function handle<T extends MessageOptions>(
	message: Message,
	options: string | T,
	extra?: T | undefined
): Promise<Message> {
	const existing = replies.get(message);

	const payloadOptions = existing
		? resolveEditPayload(existing, options as MessageEditOptions)
		: resolveSendPayload<T>(options);
	const payload = await MessagePayload.create(message.channel, payloadOptions, extra)
		.resolveBody()
		.resolveFiles();
	const response = await (existing
		? tryEdit(message, existing, payload)
		: trySend(message, payload));
	replies.set(message, response);

	return response;
}

function resolveSendPayload<T extends MessageOptions>(options: string | MessageOptions): T {
	return typeof options === "string"
		? ({ content: options, components: [] } as unknown as T)
		: ({ components: [], ...options } as T);
}

function resolveEditPayload(
	response: Message,
	options: string | MessageEditOptions
): MessageEditOptions {
	options = resolveSendPayload<MessageEditOptions>(options);

	if (response.embeds.length) options.embeds ??= [];
	if (response.attachments.size) options.attachments ??= [];

	return options;
}

async function tryEdit(message: Message, response: Message, payload: MessagePayload) {
	try {
		return await response.edit(payload);
	} catch (error) {
		// If the error isn't a Discord API Error, re-throw:
		if (!(error instanceof DiscordAPIError)) throw error;

		// If the error isn't caused by the error triggered by editing a deleted
		// message, re-throw:
		if (error.code !== RESTJSONErrorCodes.UnknownMessage) throw error;

		// Free the response temporarily, serves a dual purpose here:
		//
		// - A following `send()` (before a new one was sent) call will not
		//   trigger this error again.
		// - If the message send throws, no response will be stored.
		//
		// We always call `replies.set()` right after `tryEdit()`, so it'll be tracked
		// once the message has been sent, provided it did not throw.
		replies.delete(message);
		return trySend(message, payload);
	}
}

async function trySend(message: Message, payload: MessagePayload) {
	return (message.channel as Exclude<Message["channel"], PartialGroupDMChannel>).send(payload);
}

/**
 * Formats message content, including stickers and URLs, for display.
 *
 * @param data The data for formatting the message content.
 *   - url: The URL of the message, if available.
 * 	 - content: The text content of the message, if available.
 * 	 - stickerId: The ID of the sticker in the message, if available.
 * 	 - createdAt: The creation date of the message, if available.
 * 	 - includeUrl: Whether to include the message URL in the formatted content (default: true).
 *
 * @returns The formatted message content as a string.
 */

export async function formatMessageContent(data: {
	url: string | null;
	content: string | null;
	stickerId: string | null;
	authorId?: string;
	createdAt?: Date;
	includeUrl?: boolean;
}): Promise<string> {
	const { url, content, stickerId, authorId, createdAt, includeUrl = true } = data;
	const parts: string[] = [];

	if (createdAt && authorId) {
		const timestamp = Math.floor(createdAt.getTime() / 1000);
		parts.push(`Sent by <@${authorId}> on <t:${timestamp}:f>`);
	} else if (createdAt) {
		const timestamp = Math.floor(createdAt.getTime() / 1000);
		parts.push(`Sent on <t:${timestamp}:f>`);
	} else if (authorId) {
		parts.push(`Sent by <@${authorId}>`);
	}

	if (url && includeUrl) {
		parts.push(hyperlink("Jump to message", url));
	}

	if (stickerId) {
		const sticker = await client.fetchSticker(stickerId);
		const stickerText =
			sticker.format === StickerFormatType.Lottie
				? `Lottie Sticker: ${sticker.name}`
				: hyperlink(`Sticker: ${sticker.name}`, sticker.url);
		parts.push(stickerText);
	}

	const prefix = parts.length ? parts.join(" `|` ") : "";
	const separator = prefix ? " `|` " : "";

	if (!content) {
		return prefix + codeBlock("Unknown content.");
	}

	const escapedContent = escapeCodeBlock(content);

	if (escapedContent.length > 900) {
		const hastebinUrl = await hastebin(escapedContent, "txt");
		return prefix + separator + hyperlink("View full content", hastebinUrl!);
	}

	const maxContentLength = Math.max(0, 900 - prefix.length);
	return prefix + codeBlock(truncate(escapedContent, maxContentLength));
}

/**
 * Clean the content of a message for logging.
 *
 * @param str The string to clean.
 * @param channel The channel this message was sent in.
 * @returns The cleaned string.
 */
export function cleanContent(str: string, channel: TextBasedChannel): string {
	return djsCleanContent(
		str
			.replace(/<(a?):([^:\n\r]+):(\d{17,19})>/g, "<$1\\:$2\\:$3>")
			.replace(/<@!?(\d{17,19})>/g, "<@$1> ($1)"),
		channel
	);
}
