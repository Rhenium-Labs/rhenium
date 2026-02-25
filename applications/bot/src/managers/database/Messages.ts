import { Collection, type Message as DiscordMessage } from "discord.js";

import { kysely } from "@root/index";
import { inflect } from "@utils/index";
import { cleanContent } from "@utils/Messages";
import { EMPTY_MESSAGE_CONTENT } from "@utils/Constants";

import type { Message } from "@repo/db";

import Logger from "@utils/Logger";

/** Simple mutex for message insertion operations. */
let isInserting = false;

export default class MessageManager {
	/** Collection of cached messages. */
	private static _cache: Collection<string, Message> = new Collection();

	/** Messages that are currently being processed or handled outside this class. */
	static exclusions: Set<string> = new Set();

	/** Retrieves the number of cached messages. */
	static get size(): number {
		return this._cache.size;
	}

	/**
	 * Adds message IDs to the purge exclusion set, preventing them from being processed by other operations.
	 *
	 * @param ids The message IDs to exclude from purging.
	 * @returns void
	 */
	static addExclusions(ids: string[]): void {
		for (const id of ids) {
			this.exclusions.add(id);
		}
	}

	/**
	 * Removes message IDs from the purge exclusion set, allowing them to be processed by other operations again.
	 *
	 * @param ids The message IDs to remove from the exclusion set.
	 * @returns void
	 */
	static removeExclusions(ids: string[]): void {
		if (ids.length === 0) return;

		for (const id of ids) {
			this.exclusions.delete(id);
		}
	}

	/**
	 * Queues a message for database insertion.
	 * If the cache exceeds 5000 messages, an immediate insertion is triggered to prevent memory bloat.
	 *
	 * @param message The Discord message to be queued.
	 * @returns void
	 */
	static async queue(message: DiscordMessage<true>): Promise<void> {
		if (this._cache.size + 1 >= 5000) {
			Logger.warn(`Message cache has reached 5000 entries. Early insertion triggered.`);
			await MessageManager.insert();
		}

		const serialized = MessageManager.serialize(message);
		MessageManager._cache.set(serialized.id, serialized);
	}

	/**
	 * Serializes a Discord message into the format suitable for database storage.
	 *
	 * @param message The Discord message to serialize.
	 * @return The serialized message object.
	 */

	static serialize(message: DiscordMessage<true>): Message {
		const stickerId = message.stickers.first()?.id ?? null;
		const referenceId = message.reference?.messageId ?? null;
		const content = cleanContent(message.content ?? EMPTY_MESSAGE_CONTENT, message.channel);

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
	 * Retrieves a message from the DB or cache by its ID.
	 *
	 * @param id The ID of the message to retrieve.
	 * @return The message object if found, otherwise null.
	 */

	static async get(id: string): Promise<Message | null> {
		let message = this._cache.get(id);

		if (!message) {
			message = await kysely
				.selectFrom("Message")
				.selectAll()
				.where("id", "=", id)
				.executeTakeFirst();
		}

		return message ?? null;
	}

	/**
	 * Retrieves multiple messages by their IDs, merging results from the cache and database.
	 *
	 * @param ids An array of message IDs to retrieve.
	 * @return An array of message objects corresponding to the provided IDs.
	 */

	static async getMany(ids: string[]): Promise<Message[]> {
		const cached = ids
			.map(id => this._cache.get(id))
			.filter((msg): msg is Message => msg !== undefined);

		if (cached.length === ids.length) {
			return cached;
		}

		const missingIds = ids.filter(id => !this._cache.has(id));

		const fromDb = await kysely
			.selectFrom("Message")
			.selectAll()
			.where("id", "in", missingIds)
			.execute();

		return cached.concat(fromDb);
	}

	/**
	 * Retrieves messages for a specific channel, merging results from the cache and database.
	 *
	 * @param channelId The ID of the channel to retrieve messages from.
	 * @param limit The maximum number of messages to retrieve (default is 30).
	 * @returns An array of messages sorted by creation date in descending order.
	 */

	static async getForChannel(channelId: string, limit: number = 30): Promise<Message[]> {
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
		const messageMap = new Map<string, Message>();

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
	 * Marks a message as deleted in the cache and database.
	 *
	 * @param id The ID of the message to delete.
	 * @returns The updated message object if found, otherwise null.
	 */

	static async delete(id: string): Promise<Message | null> {
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
	 * Marks multiple messages as deleted in the cache and database.
	 *
	 * @param ids An array of message IDs to delete.
	 * @returns An array of updated message objects that were marked as deleted.
	 */

	static async bulkDelete(ids: string[]): Promise<Message[]> {
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
	static async updateContent(id: string, newContent: string): Promise<string> {
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
	 * Finds messages in the cache that match the specified criteria.
	 *
	 * @param data An object containing the search criteria:
	 *   - channelId: The ID of the channel to search within.
	 *   - authorId: The ID of the author of the messages.
	 *   - limit: The maximum number of message IDs to return.
	 *
	 * @returns An array of message IDs that match the criteria, sorted by newest first.
	 */

	static findMatchingMessages(data: {
		channelId: string;
		authorId: string;
		limit: number;
	}): string[] {
		const { channelId, authorId, limit } = data;

		const matching = this._cache.filter(
			msg => msg.channel_id === channelId && msg.author_id === authorId && !msg.deleted
		);

		return matching
			.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
			.map(msg => msg.id)
			.slice(0, limit);
	}

	/**
	 * Inserts all cached messages into the database and clears the cache.
	 *
	 * @param event Optional signal event that triggered the insertion (e.g., process exit). Used for logging purposes.
	 * @returns void
	 */
	static async insert(event?: NodeJS.Signals): Promise<void> {
		if (this._cache.size === 0) {
			Logger.info("No messages to insert.");
			return;
		}

		if (isInserting) {
			Logger.warn("Message insertion is already in progress. Skipping this insertion.");
			return;
		}

		isInserting = true;

		Logger.info(
			`Inserting cached messages ${event ? `before exiting due to ${event}` : ""}...`
		);

		const messages = Array.from(this._cache.values());
		const inserted = await kysely
			.insertInto("Message")
			.onConflict(oc => oc.column("id").doNothing())
			.values(messages)
			.returning("id")
			.execute();

		// Clear the cache manually.
		MessageManager._cache.clear();
		Logger.info(`Stored ${inserted.length} ${inflect(inserted.length, "message")}.`);

		isInserting = false;
	}
}
