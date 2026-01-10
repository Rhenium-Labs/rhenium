import {
	type Message,
	type TextBasedChannel,
	type MessageCreateOptions,
	type MessageEditOptions,
	type MessageReplyOptions,
	type PartialGroupDMChannel,
	type ReplyOptions,
	type Snowflake,
	codeBlock,
	DiscordAPIError,
	escapeCodeBlock,
	hyperlink,
	RESTJSONErrorCodes,
	StickerFormatType,
	cleanContent as djsCleanContent,
	Collection,
	MessagePayload
} from "discord.js";

import { client, prisma } from "#root/index.js";
import { hastebin, inflect, truncate } from "./index.js";
import type { Message as SerializedMessage } from "#prisma/client.js";

import Logger from "./Logger.js";

const replies = new WeakMap<Message, Message>();

type MessageOptions = MessageCreateOptions | MessageReplyOptions | MessageEditOptions;

export class MessageQueue {
	/**
	 * Collection of messages that are queued to be added to the database.
	 */
	private static readonly _cache = new Collection<Snowflake, SerializedMessage>();

	/**
	 * Queues a message to be added to the database.
	 * @param message The message to queue.
	 */

	public static queue(message: Message<true>): void {
		const messageEntry = MessageQueue._serializeMessage(message);
		MessageQueue._cache.set(message.id, messageEntry);
	}

	/**
	 * Retrieves a message from the database or the queue.
	 *
	 * @param id The ID of the message.
	 * @returns The message, or null if it does not exist.
	 */

	public static async getMessage(id: Snowflake): Promise<SerializedMessage | null> {
		let message = MessageQueue._cache.get(id) ?? null;

		if (!message) {
			message = await prisma.message.findUnique({ where: { id } });
		}

		return message;
	}

	/**
	 * Retrieves message IDs from the cache for purging.
	 * Returns messages matching the criteria, sorted newest to oldest.
	 *
	 * @param data The filter criteria for messages.
	 * @returns An array of message IDs from the cache.
	 */
	public static getMessagesForPurge(data: {
		channelId: Snowflake;
		authorId: Snowflake;
		triggerMessageId: Snowflake;
		limit: number;
	}): Snowflake[] {
		const { channelId, authorId, triggerMessageId, limit } = data;

		// Filter cached messages by channel, author, not deleted, and <= trigger message
		const matching = MessageQueue._cache.filter(
			msg =>
				msg.channel_id === channelId &&
				msg.author_id === authorId &&
				!msg.deleted &&
				msg.id <= triggerMessageId
		);

		// Sort by ID descending (newest first) and take up to limit
		return matching
			.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
			.map(msg => msg.id)
			.slice(0, limit);
	}

	/**
	 * Mark a message as deleted in the database.
	 *
	 * @param id The ID of the message to update.
	 * @returns The updated message, or null if it does not exist.
	 */

	public static async deleteMessage(id: Snowflake): Promise<SerializedMessage | null> {
		let message = MessageQueue._cache.get(id) ?? null;

		if (message) {
			message.deleted = true;
		} else {
			message = await prisma.message
				.update({
					data: { deleted: true },
					where: { id }
				})
				.catch(() => null);
		}

		return message;
	}

	/**
	 * Marks a group of messages as deleted in the database.
	 *
	 * @param ids The IDs of the messages to update.
	 * @returns The updated messages.
	 */

	public static async bulkDeleteMessages(ids: Snowflake[]): Promise<SerializedMessage[]> {
		const messages = MessageQueue._cache.filter(message => ids.includes(message.id) && !message.deleted);

		const deletedMessages = messages.map(message => {
			message.deleted = true;
			return message;
		});

		// Update what's left in the database.
		if (messages.size !== deletedMessages.length) {
			const updated = await prisma.message.updateManyAndReturn({
				where: { id: { in: ids } },
				data: { deleted: true }
			});

			// Merge the cached and stored messages.
			return deletedMessages.concat(updated);
		}

		return deletedMessages;
	}

	/**
	 * Update the content of a message.
	 *
	 * @param id The ID of the message to update.
	 * @param newContent The new content of the message.
	 * @returns The old content of the message.
	 */

	public static async updateMessage(id: Snowflake, newContent: string): Promise<string> {
		const message = MessageQueue._cache.get(id);

		if (message) {
			const oldContent = message.content ?? "No message content.";
			message.content = newContent;

			return oldContent;
		}

		const oldMessage = await prisma.message.findUnique({ where: { id } });

		await prisma.message
			.update({
				where: { id },
				data: { content: newContent }
			})
			.catch(() => null);

		return oldMessage?.content ?? "No message content.";
	}

	/** Stores all cached messages into the database. */
	static async store(event?: NodeJS.Signals): Promise<void> {
		Logger.info(`Storing cached messages ${event ? `before exiting due to ${event}` : ""}...`);

		// Insert all cached messages into the database.
		const messages = Array.from(MessageQueue._cache.values());
		const { count } = await prisma.message.createMany({ data: messages });

		// Clear the cache.
		MessageQueue._cache.clear();

		if (!count) {
			Logger.info("No messages were stored.");
		} else {
			Logger.info(`Stored ${count} ${inflect(count, "message")}.`);
		}
	}

	/**
	 * Serializes a message to make it suitable for insertion into the database.
	 *
	 * @param message The message to serialize.
	 * @returns The serialized message.
	 */

	private static _serializeMessage(message: Message<true>): SerializedMessage {
		const stickerId = message.stickers?.first()?.id ?? null;
		const referenceId = message.reference?.messageId ?? null;
		const content = cleanMessageContent(message.content, message.channel);

		return {
			id: message.id,
			guild_id: message.guild.id,
			author_id: message.author.id,
			channel_id: message.channel.id,
			sticker_id: stickerId,
			reference_id: referenceId,
			content,
			attachments: message.attachments.map(attachment => attachment.url),
			created_at: message.createdAt,
			deleted: false
		};
	}
}

/**
 * Tracks a response with a message, in a way that if {@link send} is called with `message`, `response` will be edited.
 *
 * @param message The message to track when editing.
 * @param response The response to edit when using send with `message`.
 */
function track(message: Message, response: Message): void {
	replies.set(message, response);
}

/**
 * Removes the tracked response for `message`.
 *
 * @param message The message to free from tracking.
 * @returns Whether the message was tracked.
 */
function free(message: Message): boolean {
	return replies.delete(message);
}

/**
 * Gets the tracked response to `message`, if any was tracked and was not deleted.
 * @param message The message to get the reply from.
 * @returns The replied message, if any.
 */
function get(message: Message): Message | null {
	return replies.get(message) ?? null;
}

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
						Reflect.get(options, "failIfNotExists") ?? message.client.options.failIfNotExists
				};

	return handle(message, options, { reply: replyOptions });
}

async function handle<T extends MessageOptions>(
	message: Message,
	options: string | T,
	extra?: T | undefined
): Promise<Message> {
	const existing = get(message);

	const payloadOptions = existing
		? resolveEditPayload(existing, options as MessageEditOptions)
		: resolveSendPayload<T>(options);
	const payload = await MessagePayload.create(message.channel, payloadOptions, extra).resolveBody().resolveFiles();
	const response = await (existing ? tryEdit(message, existing, payload) : trySend(message, payload));
	track(message, response);

	return response;
}

function resolveSendPayload<T extends MessageOptions>(options: string | MessageOptions): T {
	return typeof options === "string"
		? ({ content: options, components: [] } as unknown as T)
		: ({ components: [], ...options } as T);
}

function resolveEditPayload(response: Message, options: string | MessageEditOptions): MessageEditOptions {
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
		// We always call `track()` right after `tryEdit()`, so it'll be tracked
		// once the message has been sent, provided it did not throw.
		free(message);
		return trySend(message, payload);
	}
}

async function trySend(message: Message, payload: MessagePayload) {
	return (message.channel as Exclude<Message["channel"], PartialGroupDMChannel>).send(payload);
}

/**
 * Formats message content, including stickers and URLs, for display.
 *
 * @param content The message content.
 * @param stickerId The sticker ID.
 * @param url The message URL.
 * @param includeUrl Whether to include the URL in the formatted content.
 * @returns The formatted message content.
 */

export async function formatMessageContent(
	content: string | null,
	stickerId: string | null,
	url: string | null,
	includeUrl: boolean = true
): Promise<string> {
	const parts: string[] = [];

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

	if (escapedContent.length > 1024) {
		const hastebinUrl = await hastebin(escapedContent, "txt");
		return prefix + separator + hyperlink("View full content", hastebinUrl!);
	}

	const maxContentLength = Math.max(0, 1000 - prefix.length);
	return prefix + codeBlock(truncate(escapedContent, maxContentLength));
}

/**
 * Clean the content of a message for logging.
 *
 * @param str The string to clean.
 * @param channel The channel this message was sent in.
 * @returns The cleaned string.
 */
export function cleanMessageContent(str: string, channel: TextBasedChannel): string {
	return djsCleanContent(
		str.replace(/<(a?):([^:\n\r]+):(\d{17,19})>/g, "<$1\\:$2\\:$3>").replace(/<@!?(\d{17,19})>/g, "<@$1> ($1)"),
		channel
	);
}
