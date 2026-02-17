import {
	type User,
	type MessageReaction,
	type PartialMessage,
	type PartialMessageReaction,
	type Snowflake,
	type Message,
	type TextChannel,
	Events,
	EmbedBuilder,
	Colors,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	AttachmentBuilder,
	StickerFormatType
} from "discord.js";

import ms from "ms";

import {
	channelInScope,
	getEmojiIdentifier,
	hastebin,
	inflect,
	parseChannelScoping,
	sleep,
	truncate,
	userMentionWithId
} from "#utils/index.js";
import { LoggingEvent } from "#database/Enums.js";
import { client, kysely } from "#root/index.js";
import { LOG_DATE_FORMAT } from "#utils/Constants.js";

import type { Message as SerializedMessage } from "#database/Schema.js";

import GuildConfig from "#config/GuildConfig.js";
import ConfigManager from "#config/ConfigManager.js";
import EventListener from "#events/EventListener.js";
import MessageManager from "#database/Messages.js";
import ModerationUtils from "#utils/Moderation.js";

/** The maximum age of messages that can be bulk deleted (14 days in milliseconds). */
const BULK_DELETE_MAX_AGE = 14 * 24 * 60 * 60 * 1000;

/** The maximum number of messages that can be bulk deleted at once. */
const BULK_DELETE_LIMIT = 100;

/** Delay between individual message deletions to avoid rate limits (in ms). */
const INDIVIDUAL_DELETE_DELAY = 150;

/** Maximum concurrent individual deletions. */
const MAX_CONCURRENT_DELETIONS = 5;

/** Discord epoch: 2015-01-01T00:00:00.000Z */
const DISCORD_EPOCH = 1420070400000n;

/** Queue locks to prevent concurrent quick purge actions on the same message. */
const quickPurgeActionLocks: Set<Snowflake> = new Set();

/** Queue locks to prevent concurrent quick mute actions on the same message. */
const quickMuteActionLocks: Set<Snowflake> = new Set();

/** The result of a quick purge execution. */
interface QuickPurgeResult {
	ok: boolean;
	deleted: number;
	failed: number;
	entries: string[];
	message?: string;
	logUrl?: string;
}

export default class MessageReactionAdd extends EventListener {
	constructor() {
		super(Events.MessageReactionAdd);
	}

	async execute(rec: MessageReaction, user: User) {
		const [reaction, message] = await MessageReactionAdd._parseEventProps(rec, rec.message);
		if (!reaction || !message || !message.inGuild()) return;

		const config = await ConfigManager.get(message.guild.id);

		void Promise.all([
			MessageReactionAdd._handleQuickMute({ user, message, reaction, config }),
			MessageReactionAdd._handleQuickPurge({ user, message, reaction, config })
		]);
	}

	/**
	 * Handles a quick mute reaction event.
	 *
	 * @param data The data for handling the quick mute.
	 * @returns A promise that resolves when the quick mute handling is complete.
	 */

	private static async _handleQuickMute(data: {
		user: User;
		message: Message<true>;
		reaction: MessageReaction;
		config: GuildConfig;
	}): Promise<unknown> {
		const { user, message, reaction, config } = data;

		if (quickMuteActionLocks.has(message.author.id)) return;
		quickMuteActionLocks.add(message.author.id);

		try {
			const quickMuteGuildConfig = config.parseQuickActionConfig("quick_mutes");
			if (!quickMuteGuildConfig) return;

			const executor = await message.guild.members.fetch(user.id).catch(() => null);
			if (!executor) return;

			// Prevent people who had access to quick mutes but lost it from executing quick mutes.
			if (!config.hasPermission(executor, "UseQuickMute")) return;

			const channelScoping = parseChannelScoping(quickMuteGuildConfig.channel_scoping);
			if (!channelInScope(message.channel, channelScoping)) return;

			const reactionIdentifier = getEmojiIdentifier(reaction.emoji);
			if (!reactionIdentifier) return;

			const quickMuteConfig = await kysely
				.selectFrom("QuickMute")
				.where("user_id", "=", user.id)
				.where("guild_id", "=", message.guildId)
				.where("reaction", "=", reactionIdentifier)
				.selectAll()
				.executeTakeFirst();

			if (!quickMuteConfig) return;

			const target = await message.guild.members
				.fetch(message.author.id)
				.catch(() => null);

			if (!target) return;

			if (target.isCommunicationDisabled()) {
				return config.log(LoggingEvent.QuickMuteResult, {
					content: `${executor}, ${target} is already muted.`
				});
			}

			if (
				!message.channel
					.permissionsFor(executor.guild.members.me!)
					.has("ModerateMembers")
			) {
				return config.log(LoggingEvent.QuickMuteResult, {
					content: `${executor}, I do not have the "Timeout Members" permission which is required to mute ${target}.`
				});
			}

			const validationResult = ModerationUtils.validateAction(
				target,
				executor,
				"Quick Mute"
			);

			if (!validationResult.ok) {
				return config.log(LoggingEvent.QuickMuteResult, {
					content: `${executor}, ${validationResult.message}`
				});
			}

			const truncatedReason = truncate(
				`Quick mute issued by @${executor.user.username} (${executor.id}) - ${quickMuteConfig.reason}`,
				512
			);
			const formattedDuration = ms(quickMuteConfig.duration, { long: true });

			const result = await target
				.timeout(Number(quickMuteConfig.duration), truncatedReason)
				.then(() => ({ ok: true }))
				.catch(() => ({ ok: false }));

			if (!result.ok) {
				return config.log(LoggingEvent.QuickMuteResult, {
					content: `${executor}, failed to quick mute ${target}.`
				});
			}

			// Handle message deletion/purge
			let purgeResult: QuickPurgeResult | null = null;

			const purgeAmount = Math.min(
				quickMuteConfig.purge_amount,
				quickMuteGuildConfig.purge_limit
			);

			if (purgeAmount > 1) {
				purgeResult = await MessageReactionAdd._executePurge({
					channel: message.channel as TextChannel,
					authorId: message.author.id,
					triggerMessage: message,
					amount: purgeAmount
				});
			} else {
				await message.delete().catch(() => null);
			}

			const embed = new EmbedBuilder()
				.setAuthor({ name: `Quick Mute Executed (${formattedDuration})` })
				.setThumbnail(target.user.displayAvatarURL({ size: 64 }))
				.setColor(Colors.Blue)
				.setFields([
					{
						name: "Target",
						value: userMentionWithId(target.id)
					},
					{
						name: "Executor",
						value: userMentionWithId(executor.id)
					},
					{
						name: "Reason",
						value: quickMuteConfig.reason
					}
				])
				.setTimestamp();

			if (purgeResult?.ok && purgeResult.deleted > 0) {
				embed.addFields({
					name: "Messages Purged",
					value: `${purgeResult.deleted} ${inflect(purgeResult.deleted, "message")}${purgeResult.failed > 0 ? ` (${purgeResult.failed} failed)` : ""}${purgeResult.logUrl ? `- [View Deleted Messages](${purgeResult.logUrl})` : ""}`
				});
			}

			const content =
				purgeResult?.ok && purgeResult.deleted > 0
					? `${executor}, successfully quick muted ${target} for \`${formattedDuration}\` and purged \`${purgeResult.deleted}\`/\`${purgeAmount}\` ${inflect(purgeResult.deleted, "message")} in ${message.channel}.`
					: `${executor}, successfully quick muted ${target} for \`${formattedDuration}\`.`;

			if (purgeResult?.ok && purgeResult.deleted > 0) {
				const entries = purgeResult.entries ?? [];
				const attachment = MessageReactionAdd._mapLogEntriesToFile(entries);
				const components: ActionRowBuilder<ButtonBuilder>[] = [];

				if (purgeResult.logUrl) {
					const button = new ButtonBuilder()
						.setLabel("Open In Browser")
						.setStyle(ButtonStyle.Link)
						.setURL(purgeResult.logUrl);

					const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
					components.push(row);
				}

				return Promise.all([
					config.log(LoggingEvent.QuickMuteExecuted, { embeds: [embed] }),
					config.log(LoggingEvent.QuickMuteResult, {
						content,
						components,
						files: [attachment]
					})
				]);
			}

			return Promise.all([
				config.log(LoggingEvent.QuickMuteExecuted, { embeds: [embed] }),
				config.log(LoggingEvent.QuickMuteResult, { content })
			]);
		} catch {
			quickMuteActionLocks.delete(message.author.id);
		} finally {
			quickMuteActionLocks.delete(message.author.id);
		}
	}

	/**
	 * Handles a quick purge reaction event.
	 *
	 * @param data The data for handling the quick purge.
	 * @returns A promise that resolves when the quick purge handling is complete.
	 */

	private static async _handleQuickPurge(data: {
		user: User;
		message: Message<true>;
		reaction: MessageReaction;
		config: GuildConfig;
	}): Promise<unknown> {
		const { user, message, reaction, config } = data;

		if (quickPurgeActionLocks.has(message.author.id)) return;
		quickPurgeActionLocks.add(message.author.id);

		try {
			const quickPurgeGuildConfig = config.parseQuickActionConfig("quick_purges");
			if (!quickPurgeGuildConfig) return;

			const executor = await message.guild.members.fetch(user.id).catch(() => null);
			if (!executor) return;

			// Prevent people who had access to quick purges but lost it from executing quick purges.
			if (!config.hasPermission(executor, "UseQuickPurge")) return;

			const channelScoping = parseChannelScoping(quickPurgeGuildConfig.channel_scoping);
			if (!channelInScope(message.channel, channelScoping)) return;

			const reactionIdentifier = getEmojiIdentifier(reaction.emoji);
			if (!reactionIdentifier) return;

			const quickPurgeConfig = await kysely
				.selectFrom("QuickPurge")
				.where("user_id", "=", user.id)
				.where("guild_id", "=", message.guildId)
				.where("reaction", "=", reactionIdentifier)
				.selectAll()
				.executeTakeFirst();

			if (!quickPurgeConfig) return;

			const target = await message.guild.members
				.fetch(message.author.id)
				.catch(() => null);
			if (!target) return;

			if (!message.channel.permissionsFor(executor).has("ManageMessages")) {
				return config.log(LoggingEvent.QuickPurgeResult, {
					content: `${executor}, you do not have permission to manage messages in ${message.channel}.`
				});
			}

			if (
				!message.channel
					.permissionsFor(executor.guild.members.me!)
					.has("ManageMessages")
			) {
				return config.log(LoggingEvent.QuickPurgeResult, {
					content: `${executor}, I do not have permission to manage messages in ${message.channel}, which is required to purge messages.`
				});
			}

			const purgeAmount = Math.min(
				quickPurgeConfig.purge_amount,
				quickPurgeGuildConfig.max_limit
			);

			const purgeResult = await MessageReactionAdd._executePurge({
				channel: message.channel as TextChannel,
				authorId: message.author.id,
				triggerMessage: message,
				amount: purgeAmount
			});

			if (!purgeResult.ok || purgeResult.deleted === 0) {
				return config.log(LoggingEvent.QuickPurgeResult, {
					content: `${executor}, failed to quick purge messages for ${target}: ${purgeResult.message}`
				});
			}

			const entries = purgeResult.entries ?? [];
			const attachment = MessageReactionAdd._mapLogEntriesToFile(entries);
			const components: ActionRowBuilder<ButtonBuilder>[] = [];
			const hasteURL = purgeResult.logUrl ?? null;

			const content = `${executor}, successfully purged \`${purgeResult.deleted}\`/\`${purgeAmount}\` ${inflect(purgeResult.deleted, "message")} from ${target} in ${message.channel}.`;

			const embed = new EmbedBuilder()
				.setAuthor({ name: "Quick Purge Executed" })
				.setThumbnail(target.user.displayAvatarURL({ size: 64 }))
				.setColor(Colors.Blue)
				.setFields([
					{
						name: "Target",
						value: userMentionWithId(target.id)
					},
					{
						name: "Executor",
						value: userMentionWithId(executor.id)
					},
					{
						name: "Channel",
						value: `<#${message.channel.id}>`
					},
					{
						name: "Purge Result",
						value: `${purgeResult.deleted} ${inflect(purgeResult.deleted, "message")}${purgeResult.failed > 0 ? ` (${purgeResult.failed} failed)` : ""}${hasteURL ? ` - [View Deleted Messages](${hasteURL})` : ""}`
					}
				])
				.setTimestamp();

			if (hasteURL) {
				const button = new ButtonBuilder()
					.setLabel("Open In Browser")
					.setStyle(ButtonStyle.Link)
					.setURL(hasteURL);

				const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
				components.push(row);
			}

			return Promise.all([
				config.log(LoggingEvent.QuickPurgeExecuted, { embeds: [embed] }),
				config.log(LoggingEvent.QuickPurgeResult, {
					content,
					components,
					files: [attachment]
				})
			]);
		} catch {
			quickPurgeActionLocks.delete(message.author.id);
		} finally {
			quickPurgeActionLocks.delete(message.author.id);
		}
	}

	/**
	 * Executes the purge operation for messages from a specific user in a channel.
	 * Uses cached/stored messages to bypass Discord's 14-day bulk delete limit.
	 *
	 * @param data The data for executing the purge.
	 * @returns The result of the purge operation.
	 */
	private static async _executePurge(data: {
		channel: TextChannel;
		authorId: Snowflake;
		triggerMessage: Message<true>;
		amount: number;
	}): Promise<QuickPurgeResult> {
		const { channel, authorId, triggerMessage, amount } = data;

		const messageIds = await MessageReactionAdd._fetchPurgeableMessages({
			channelId: channel.id,
			authorId,
			limit: amount
		});

		try {
			if (messageIds.length === 0) {
				return {
					ok: true,
					deleted: 0,
					failed: 0,
					message: "No messages found to purge.",
					entries: []
				};
			}

			// Add message IDs to exclusion set before deleting to prevent
			// duplicate handling from MessageDelete/MessageBulkDelete events.
			MessageManager.addExclusions(messageIds);

			const now = Date.now();
			const bulkDeletableIds: Snowflake[] = [];
			const individualDeletableIds: Snowflake[] = [];

			for (const id of messageIds) {
				const messageTimestamp = MessageReactionAdd._snowflakeToTimestamp(id);
				const age = now - messageTimestamp;

				if (age < BULK_DELETE_MAX_AGE) {
					bulkDeletableIds.push(id);
				} else {
					individualDeletableIds.push(id);
				}
			}

			let deleted = 0;
			let failed = 0;

			await triggerMessage.delete().catch(() => null);

			// Remove the trigger message from deletion lists since it was already deleted above.
			const triggerIdx1 = bulkDeletableIds.indexOf(triggerMessage.id);
			if (triggerIdx1 !== -1) bulkDeletableIds.splice(triggerIdx1, 1);

			const triggerIdx2 = individualDeletableIds.indexOf(triggerMessage.id);
			if (triggerIdx2 !== -1) individualDeletableIds.splice(triggerIdx2, 1);

			// Count the trigger message as a successful deletion.
			deleted++;

			if (bulkDeletableIds.length > 0) {
				const bulkResult = await MessageReactionAdd._bulkDeleteMessages(
					channel,
					bulkDeletableIds
				);
				deleted += bulkResult.deleted;
				failed += bulkResult.failed;
			}

			if (individualDeletableIds.length > 0) {
				const individualResult = await MessageReactionAdd._individualDeleteMessages(
					channel,
					individualDeletableIds
				);
				deleted += individualResult.deleted;
				failed += individualResult.failed;
			}

			const serializedMessages = await MessageManager.bulkDelete(messageIds);
			const entries = await MessageReactionAdd._getMessageLogEntries(serializedMessages);
			const logUrl = (await hastebin(entries.join("\n\n"))) ?? undefined;

			// Remove exclusions after purge execution is complete.
			MessageManager.removeExclusions(messageIds);

			if (deleted === 0) {
				return {
					ok: false,
					deleted: 0,
					failed,
					entries,
					message: "All message deletions failed."
				};
			}

			return { ok: true, deleted, failed, entries, logUrl };
		} catch (error) {
			// Make sure to clean up exclusions even on error.
			MessageManager.removeExclusions(messageIds);

			return {
				ok: false,
				deleted: 0,
				failed: amount,
				entries: [],
				message: "An unexpected error occurred during the purge."
			};
		}
	}

	/**
	 * Fetches message IDs that can be purged from cache and database.
	 * Checks the in-memory cache first, then falls back to database if needed.
	 * Returns messages in reverse chronological order.
	 */
	private static async _fetchPurgeableMessages(data: {
		channelId: Snowflake;
		authorId: Snowflake;
		limit: number;
	}): Promise<Snowflake[]> {
		const { channelId, authorId, limit } = data;

		const cachedMessages = MessageManager.findMatchingMessages({
			channelId,
			authorId,
			limit
		});

		if (cachedMessages.length >= limit) {
			return cachedMessages.slice(0, limit);
		}

		const remaining = limit - cachedMessages.length;
		const cachedIds = new Set(cachedMessages);

		const messages = await kysely
			.selectFrom("Message")
			.select(["Message.id"])
			.where("Message.channel_id", "=", channelId)
			.where("Message.author_id", "=", authorId)
			.where("Message.deleted", "=", false)
			.$if(cachedIds.size > 0, qb => qb.where("Message.id", "not in", [...cachedIds]))
			.orderBy("Message.created_at", "desc")
			.limit(remaining)
			.execute();

		const dbMessageIds = messages.map(m => m.id);
		return [...cachedMessages, ...dbMessageIds];
	}

	/**
	 * Bulk deletes messages using Discord's bulk delete API.
	 * Handles chunking into groups of 100.
	 */
	private static async _bulkDeleteMessages(
		channel: TextChannel,
		messageIds: Snowflake[]
	): Promise<{ deleted: number; failed: number }> {
		let deleted = 0;
		let failed = 0;

		for (let i = 0; i < messageIds.length; i += BULK_DELETE_LIMIT) {
			const chunk = messageIds.slice(i, i + BULK_DELETE_LIMIT);

			try {
				const deletedMessages = await channel.bulkDelete(chunk, true);
				deleted += deletedMessages.size;

				failed += chunk.length - deletedMessages.size;
			} catch {
				const individualResult = await MessageReactionAdd._individualDeleteMessages(
					channel,
					chunk
				);
				deleted += individualResult.deleted;
				failed += individualResult.failed;
			}
		}

		return { deleted, failed };
	}

	/**
	 * Deletes messages individually with rate limit handling.
	 * Uses controlled concurrency and delays to avoid hitting rate limits.
	 */
	private static async _individualDeleteMessages(
		channel: TextChannel,
		messageIds: Snowflake[]
	): Promise<{ deleted: number; failed: number }> {
		let deleted = 0;
		let failed = 0;

		for (let i = 0; i < messageIds.length; i += MAX_CONCURRENT_DELETIONS) {
			const batch = messageIds.slice(i, i + MAX_CONCURRENT_DELETIONS);

			const results = await Promise.allSettled(
				batch.map(id => MessageReactionAdd._deleteMessage(channel, id))
			);

			for (const result of results) {
				if (result.status === "fulfilled" && result.value) {
					deleted++;
				} else {
					failed++;
				}
			}

			if (i + MAX_CONCURRENT_DELETIONS < messageIds.length) {
				await sleep(INDIVIDUAL_DELETE_DELAY);
			}
		}

		return { deleted, failed };
	}

	/**
	 * Attempts to delete a single message by ID.
	 * Returns true if successful, false otherwise.
	 */
	private static async _deleteMessage(
		channel: TextChannel,
		messageId: Snowflake
	): Promise<boolean> {
		try {
			const message = await channel.messages.fetch(messageId).catch(() => null);

			if (message) {
				await message.delete();
				return true;
			}

			// Message might already be deleted.
			return false;
		} catch {
			return false;
		}
	}

	/**
	 * Converts a Discord snowflake to a timestamp.
	 */
	private static _snowflakeToTimestamp(snowflake: Snowflake): number {
		return Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH);
	}

	/**
	 * Maps log entries to a file attachment.
	 *
	 * @param entries The log entries to map.
	 * @returns The attachment containing the log entries.
	 */

	private static _mapLogEntriesToFile(entries: string[]): AttachmentBuilder {
		const buffer = Buffer.from(entries.join("\n\n"), "utf-8");
		return new AttachmentBuilder(buffer, { name: "log-data.txt" });
	}

	/**
	 * Generates log entries for a list of serialized messages.
	 *
	 * @param messages The serialized messages to generate log entries for.
	 * @returns The formatted log entries.
	 */

	private static async _getMessageLogEntries(messages: SerializedMessage[]): Promise<string[]> {
		const authorCache = new Map<Snowflake, User | { username: string; id: Snowflake }>();
		const entries: { entry: string; createdAt: Date }[] = [];

		// Helper function to get or fetch author.
		const getAuthor = async (authorId: Snowflake) => {
			const cached = authorCache.get(authorId);
			if (cached) return cached;

			const author = await client.users.fetch(authorId).catch(() => ({
				username: "unknown user",
				id: authorId
			}));

			authorCache.set(authorId, author);
			return author;
		};

		for (const message of messages) {
			const author = await getAuthor(message.author_id);
			const mainEntry = await MessageReactionAdd._formatMessageLogEntry({
				author,
				messageId: message.id,
				createdAt: message.created_at,
				stickerId: null,
				messageContent: message.content,
				messageAttachments: message.attachments
			});

			const subEntries = [mainEntry];

			// Handle message reference if it exists.
			if (message.reference_id) {
				const reference = await MessageManager.get(message.reference_id);

				if (reference) {
					const refAuthor = await getAuthor(reference.author_id);
					const refEntry = await MessageReactionAdd._formatMessageLogEntry({
						author: refAuthor,
						messageId: reference.id,
						createdAt: reference.created_at,
						stickerId: null,
						messageContent: reference.content,
						messageAttachments: reference.attachments
					});

					subEntries.unshift(`REF: ${refEntry}`);
				}
			}

			entries.push({
				entry: subEntries.join("\n └── "),
				createdAt: message.created_at
			});
		}

		// Clear cache manually.
		authorCache.clear();

		const sorted = entries
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.map(({ entry }) => entry);

		return sorted;
	}

	/**
	 * Formats a single message log entry.
	 *
	 * @param data The data for formatting the log entry.
	 * @returns The formatted log entry string.
	 */

	private static async _formatMessageLogEntry(data: {
		createdAt: Date;
		stickerId: Snowflake | null;
		messageId: Snowflake;
		author: User | { username: string; id: Snowflake };
		messageContent: string | null;
		messageAttachments: string[];
	}): Promise<string> {
		const timestamp = data.createdAt.toLocaleString(undefined, LOG_DATE_FORMAT);
		const author = data.author;

		let content: string | undefined;

		if (data.stickerId) {
			const sticker = await client.fetchSticker(data.stickerId).catch(() => null);

			if (sticker && sticker.format === StickerFormatType.Lottie) {
				content = `Lottie Sticker "${sticker.name}": ${data.stickerId}`;
			} else if (sticker) {
				content = `Sticker "${sticker.name}": ${sticker.url}`;
			}

			if (data.messageContent && content) {
				content = ` | Message Content: ${data.messageContent}`;
			}
		}

		content ??= data.messageContent ?? "No message content.";

		const mainLine = `[${data.messageId}] [${timestamp}] @${author.username} (${author.id}) - ${content}`;

		if (data.messageAttachments.length > 0) {
			const attachmentLines = data.messageAttachments.map(
				(url, i) => `   └── #${i + 1}: ${url}`
			);

			return [mainLine, ...attachmentLines].join("\n");
		}

		return mainLine;
	}

	private static async _parseEventProps(
		reaction: PartialMessageReaction | MessageReaction,
		message: PartialMessage | Message
	): Promise<readonly [MessageReaction | null, Message | null]> {
		const parsedReaction = reaction.partial
			? await reaction.fetch().catch(() => null)
			: reaction;
		const parsedMessage = message.partial ? await message.fetch().catch(() => null) : message;

		return [parsedReaction, parsedMessage] as const;
	}
}
