import {
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
	Message,
	RESTJSONErrorCodes,
	StickerFormatType,
	cleanContent as djsCleanContent,
	Collection,
	MessagePayload
} from "discord.js";

import { client, kysely } from "#root/index.js";
import { EMPTY_MESSAGE_CONTENT } from "./Constants.js";
import { hastebin, inflect, truncate } from "./index.js";

import type { Message as SerializedMessage } from "#kysely/Schema.js";

import Logger from "./Logger.js";

type MessageOptions = MessageCreateOptions | MessageReplyOptions | MessageEditOptions;

export default class Messages {
	/**
	 * Collection of messages that are queued to be added to the database.
	 */
	private static readonly _cache = new Collection<Snowflake, SerializedMessage>();

	/**
	 * Tracks reply messages for sent responses.
	 */
	private static readonly _replies = new WeakMap<Message, Message>();

	/**
	 * Set of message IDs currently being purged. Used to prevent duplicate
	 * delete operations when Discord emits MessageDelete/MessageBulkDelete events
	 * for messages that are already being handled by a purge action.
	 */
	static readonly purgeExclusions = new Set<Snowflake>();

	/**
	 * Sends a message as a response for `message`, and tracks it.
	 *
	 * @param message The message to reply to.
	 * @param options The options for the message sending, identical to `TextBasedChannel#send`'s options.
	 * @returns The response message.
	 */
	static send(message: Message, options: string | MessageOptions): Promise<Message> {
		return this._handle(message, options);
	}

	/**
	 * Sends a reply message as a response for `message`, and tracks it.
	 *
	 * @param message The message to reply to.
	 * @param options The options for the message sending, identical to `TextBasedChannel#send`'s options.
	 * @returns The response message.
	 */
	static reply(message: Message, options: string | MessageOptions): Promise<Message> {
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

		return this._handle(message, options, { reply: replyOptions });
	}

	/** Returns the number of messages currently in the queue. */
	static get size(): number {
		return this._cache.size;
	}

	/**
	 * Adds message IDs to the purge exclusion set.
	 * Messages in this set will be ignored by deleteMessage and bulkDeleteMessages.
	 *
	 * @param ids The message IDs to exclude.
	 */
	static addPurgeExclusions(ids: Snowflake[]): void {
		for (const id of ids) {
			this.purgeExclusions.add(id);
		}
	}

	/**
	 * Removes message IDs from the purge exclusion set.
	 *
	 * @param ids The message IDs to remove from exclusions.
	 */
	static removePurgeExclusions(ids: Snowflake[]): void {
		if (ids.length === 0) return;

		for (const id of ids) {
			this.purgeExclusions.delete(id);
		}
	}

	/**
	 * Queues a message to be added to the database.
	 *
	 * @param message The message to queue.
	 */
	static enqueue(message: Message<true>): void {
		const messageEntry = Messages.serialize(message);
		this._cache.set(message.id, messageEntry);
	}

	/**
	 * Retrieves a message from the database or the queue.
	 *
	 * @param id The ID of the message.
	 * @returns The message, or null if it does not exist.
	 */
	static async get(id: Snowflake): Promise<SerializedMessage | null> {
		let message = this._cache.get(id);

		if (!message) {
			// prettier-ignore
			message = await kysely
				.selectFrom("Message")
				.selectAll()
				.where("id", "=", id)
				.executeTakeFirst();
		}

		return message ?? null;
	}

	/**
	 * Retrieves message IDs from the cache for purging.
	 * Returns messages matching the criteria, sorted newest to oldest.
	 *
	 * @param data The filter criteria for messages.
	 * @returns An array of message IDs from the cache.
	 */
	static getForPurge(data: {
		channelId: Snowflake;
		authorId: Snowflake;
		triggerMessageId: Snowflake;
		limit: number;
	}): Snowflake[] {
		const { channelId, authorId, triggerMessageId, limit } = data;

		// Filter cached messages by channel, author, not deleted, and <= trigger message
		const matching = this._cache.filter(
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
	 * Retrieves messages for a specific channel from both cache and database.
	 * Returns messages sorted by creation time (newest first).
	 *
	 * @param channelId The channel ID to get messages for.
	 * @param limit The maximum number of messages to return.
	 * @returns An array of serialized messages.
	 */
	static async getForChannel(
		channelId: Snowflake,
		limit: number = 30
	): Promise<SerializedMessage[]> {
		const cachedMessages = this._cache.filter(
			msg => msg.channel_id === channelId && !msg.deleted
		);

		const messages = await kysely
			.selectFrom("Message")
			.selectAll()
			.where("channel_id", "=", channelId)
			.orderBy("created_at", "desc")
			.limit(limit)
			.execute();

		// Merge and deduplicate (cache takes priority).
		const messageMap = new Map<Snowflake, SerializedMessage>();

		for (const msg of messages) {
			messageMap.set(msg.id, msg);
		}

		for (const [id, msg] of cachedMessages) {
			messageMap.set(id, msg);
		}

		// Sort by created_at descending and limit.
		return Array.from(messageMap.values())
			.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
			.slice(0, limit);
	}

	/**
	 * Mark a message as deleted in the database.
	 *
	 * @param id The ID of the message to update.
	 * @returns The updated message, or null if it does not exist.
	 */
	static async delete(id: Snowflake): Promise<SerializedMessage | null> {
		let message = this._cache.get(id);

		if (message) {
			message.deleted = true;
		} else {
			message = await kysely
				.updateTable("Message")
				.set({ deleted: true })
				.where("id", "=", id)
				.returningAll()
				.executeTakeFirst();
		}

		return message ?? null;
	}

	/**
	 * Marks a group of messages as deleted in the database.
	 *
	 * @param ids The IDs of the messages to update.
	 * @returns The updated messages.
	 */
	static async bulkDelete(ids: Snowflake[]): Promise<SerializedMessage[]> {
		const messages = this._cache.filter(
			message => ids.includes(message.id) && !message.deleted
		);

		const deletedMessages = messages.map(message => {
			message.deleted = true;
			return message;
		});

		// Update what's left in the database.
		if (messages.size !== ids.length) {
			const updated = await kysely
				.updateTable("Message")
				.set({ deleted: true })
				.where("id", "in", ids)
				.returningAll()
				.execute();

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
	static async update(id: Snowflake, newContent: string): Promise<string> {
		const message = this._cache.get(id);

		if (message) {
			const oldContent = message.content ?? EMPTY_MESSAGE_CONTENT;
			message.content = newContent;

			return oldContent;
		}

		const result = await kysely
			.with("old", db => db.selectFrom("Message").select("content").where("id", "=", id))
			.updateTable("Message")
			.set({ content: newContent })
			.where("id", "=", id)
			.returning(eb => eb.selectFrom("old").select("content").as("old_content"))
			.executeTakeFirst();

		return result?.old_content ?? EMPTY_MESSAGE_CONTENT;
	}

	/**
	 * Stores all cached messages into the database.
	 *
	 * @param event Optional signal that triggered the store operation.
	 * @returns A promise that resolves when the operation is complete.
	 */
	static async store(event?: NodeJS.Signals): Promise<void> {
		if (this._cache.size === 0) {
			Logger.info("No cached messages to store.");
			return;
		}

		Logger.info(
			`Storing cached messages ${event ? `before exiting due to ${event}` : ""}...`
		);

		let insertedCount = 0;

		try {
			// Chunk messages into batches of 2500 to not exceed PostgreSQL's parameter limit (65535).
			for (let i = 0; i < this._cache.size; i += 2500) {
				const batch = Array.from(this._cache.values()).slice(i, i + 2500);

				const inserted = await kysely
					.insertInto("Message")
					.values(batch)
					.returning("id")
					.execute();

				insertedCount += inserted.length;
			}

			this._cache.clear();
			Logger.info(`Stored ${insertedCount} ${inflect(insertedCount, "message")}.`);
		} catch (error) {
			Logger.error("Failed to store cached messages:", error);
		}
	}

	/**
	 * Serializes a message to make it suitable for insertion into the database.
	 *
	 * @param message The message to serialize.
	 * @returns The serialized message.
	 */
	static serialize(message: Message<true>): SerializedMessage {
		const stickerId = message.stickers.first()?.id ?? null;
		const referenceId = message.reference?.messageId ?? null;
		const content = Messages.cleanContent(
			message.content ?? EMPTY_MESSAGE_CONTENT,
			message.channel
		);

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

	/**
	 * Formats message content, including stickers and URLs, for display.
	 *
	 * @param content The message content.
	 * @param stickerId The sticker ID.
	 * @param url The message URL.
	 * @param options Additional formatting options.
	 * @returns The formatted message content.
	 */

	static async formatContent(data: {
		url: string | null;
		content: string | null;
		stickerId: string | null;
		createdAt?: Date;
		includeUrl?: boolean;
	}): Promise<string> {
		const { url, content, stickerId, createdAt, includeUrl = true } = data;
		const parts: string[] = [];

		if (createdAt) {
			const timestamp = Math.floor(createdAt.getTime() / 1000);
			parts.push(`Sent on <t:${timestamp}:f>`);
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
	static cleanContent(str: string, channel: TextBasedChannel): string {
		return djsCleanContent(
			str
				.replace(/<(a?):([^:\n\r]+):(\d{17,19})>/g, "<$1\\:$2\\:$3>")
				.replace(/<@!?(\d{17,19})>/g, "<@$1> ($1)"),
			channel
		);
	}

	/**
	 * Handles sending or editing a message response.
	 *
	 * @param message The original message to respond to.
	 * @param options The message options.
	 * @param extra Additional options to merge into the payload.
	 * @returns The sent or edited message.
	 */
	private static async _handle<T extends MessageOptions>(
		message: Message,
		options: string | T,
		extra?: T | undefined
	): Promise<Message> {
		const existing = this._replies.get(message) ?? null;

		const payloadOptions = existing
			? this._resolveEditPayload(existing, options as MessageEditOptions)
			: this._resolveSendPayload<T>(options);

		const payload = await MessagePayload.create(message.channel, payloadOptions, extra)
			.resolveBody()
			.resolveFiles();

		const response = await (existing
			? this._tryEdit(message, existing, payload)
			: this._trySend(message, payload));

		this._replies.set(message, response);

		return response;
	}

	/**
	 * Resolves options into a send payload.
	 *
	 * @param options The message options (string or object).
	 * @returns The resolved payload options.
	 */
	private static _resolveSendPayload<T extends MessageOptions>(
		options: string | MessageOptions
	): T {
		return typeof options === "string"
			? ({ content: options, components: [] } as unknown as T)
			: ({ components: [], ...options } as T);
	}

	/**
	 * Resolves options into an edit payload, preserving embeds and attachments.
	 *
	 * @param response The existing response message.
	 * @param options The edit options.
	 * @returns The resolved edit payload.
	 */
	private static _resolveEditPayload(
		response: Message,
		options: string | MessageEditOptions
	): MessageEditOptions {
		const resolved = this._resolveSendPayload<MessageEditOptions>(options);

		if (response.embeds.length) resolved.embeds ??= [];
		if (response.attachments.size) resolved.attachments ??= [];

		return resolved;
	}

	/**
	 * Attempts to edit an existing message, falling back to send if the message was deleted.
	 *
	 * @param message The original message.
	 * @param response The existing response to edit.
	 * @param payload The message payload.
	 * @returns The edited or newly sent message.
	 */
	private static async _tryEdit(
		message: Message,
		response: Message,
		payload: MessagePayload
	): Promise<Message> {
		try {
			return await response.edit(payload);
		} catch (error) {
			// If the error isn't a Discord API Error, re-throw:
			if (!(error instanceof DiscordAPIError)) throw error;

			// If the error isn't caused by editing a deleted message, re-throw:
			if (error.code !== RESTJSONErrorCodes.UnknownMessage) throw error;

			// Free the response temporarily, serves a dual purpose here:
			//
			// - A following `send()` (before a new one was sent) call will not
			//   trigger this error again.
			// - If the message send throws, no response will be stored.
			//
			// We always call `_handle()` right after `_tryEdit()`, so it'll be tracked
			// once the message has been sent, provided it did not throw.
			this._replies.delete(message);
			return this._trySend(message, payload);
		}
	}

	/**
	 * Sends a message to the channel.
	 *
	 * @param message The original message (used to get the channel).
	 * @param payload The message payload.
	 * @returns The sent message.
	 */
	private static _trySend(message: Message, payload: MessagePayload): Promise<Message> {
		return (message.channel as Exclude<Message["channel"], PartialGroupDMChannel>).send(
			payload
		);
	}
}
