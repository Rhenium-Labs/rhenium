import {
	type User,
	type Snowflake,
	type TextChannel,
	type Guild,
	Events,
	GatewayDispatchEvents,
	GatewayDispatchPayload,
	EmbedBuilder,
	Colors,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	AttachmentBuilder,
	StickerFormatType
} from "discord.js";
import { captureException, metrics } from "@sentry/node";

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
import { LoggingEvent, UserPermission } from "@repo/config";
import { client, kysely } from "#root/index.js";
import { LOG_DATE_FORMAT, SENTRY_METRICS_COUNTERS } from "#utils/Constants.js";

import type { Message as SerializedMessage } from "@repo/db";

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
const INDIVIDUAL_DELETE_DELAY = 50;

/** Maximum concurrent individual deletions. */
const MAX_CONCURRENT_DELETIONS = 10;

/** Discord epoch: 2015-01-01T00:00:00.000Z */
const DISCORD_EPOCH = 1420070400000n;

/** Queue locks to prevent concurrent quick purge actions on the same message. */
const quickPurgeActionLocks: Set<Snowflake> = new Set();

/** Queue locks to prevent concurrent quick mute actions on the same message. */
const quickMuteActionLocks: Set<Snowflake> = new Set();

/** Raw reaction data from the gateway, resolved before handling. */
interface RawReactionData {
	reactorId: Snowflake;
	messageId: Snowflake;
	messageAuthorId: Snowflake;
	channelId: Snowflake;
	guildId: Snowflake;
	emoji: { id: string | null; name: string | null };
}

/** Resolved reaction context including fetched Discord objects. */
interface ResolvedReactionContext extends RawReactionData {
	guild: Guild;
	channel: TextChannel;
	config: GuildConfig;
}

/** The result of a quick purge execution. */
interface QuickPurgeResult {
	ok: boolean;
	deleted: number;
	failed: number;
	entries: string[];
	message?: string;
	logUrl?: string;
}

export default class Raw extends EventListener {
	constructor() {
		super(Events.Raw);
	}

	async execute(packet: GatewayDispatchPayload): Promise<void> {
		void metrics.count(SENTRY_METRICS_COUNTERS.GatewayPayloadReceived, 1, {
			attributes: { t: packet.t }
		});

		const { t: type, d: data } = packet;

		if (type !== GatewayDispatchEvents.MessageReactionAdd) return;
		if (!data.guild_id) return;

		const authorId =
			data.message_author_id ?? (await MessageManager.get(data.message_id))?.author_id;

		if (!authorId) return;

		return Raw._handleReactionAdd({
			reactorId: data.user_id,
			messageId: data.message_id,
			messageAuthorId: authorId,
			channelId: data.channel_id,
			guildId: data.guild_id,
			emoji: data.emoji
		});
	}

	/**
	 * Handles a raw message reaction add event.
	 *
	 * @param data The raw reaction data.
	 * @returns A promise that resolves when the reaction handling is complete.
	 */

	private static async _handleReactionAdd(data: RawReactionData): Promise<void> {
		const config = await ConfigManager.getGuildConfig(data.guildId);

		const guild = client.guilds.cache.get(data.guildId);
		if (!guild) return;

		const channel = client.channels.cache.get(data.channelId) as TextChannel | undefined;
		if (!channel) return;

		const context: ResolvedReactionContext = { ...data, guild, channel, config };
		Promise.all([Raw._handleQuickMute(context), Raw._handleQuickPurge(context)]);
	}

	/**
	 * Handles a quick mute reaction event.
	 *
	 * @param data The data for handling the quick mute.
	 * @returns A promise that resolves when the quick mute handling is complete.
	 */

	private static async _handleQuickMute(data: ResolvedReactionContext): Promise<unknown> {
		const { reactorId, messageId, messageAuthorId, guildId, emoji, guild, channel, config } =
			data;

		if (quickMuteActionLocks.has(messageAuthorId)) return;
		quickMuteActionLocks.add(messageAuthorId);

		try {
			const quickMuteGuildConfig = config.parseQuickActionConfig("quick_mutes");
			if (!quickMuteGuildConfig) return;

			const reactionIdentifier = getEmojiIdentifier(emoji);
			if (!reactionIdentifier) return;

			const quickMuteConfig = await kysely
				.selectFrom("QuickMute")
				.where("user_id", "=", reactorId)
				.where("guild_id", "=", guildId)
				.where("reaction", "=", reactionIdentifier)
				.selectAll()
				.executeTakeFirst();

			if (!quickMuteConfig) return;

			const executor = await guild.members.fetch(reactorId).catch(() => null);
			if (!executor) return;

			// Prevent people who had access to quick mutes but lost it from executing quick mutes.
			if (!config.hasPermission(executor, UserPermission.UseQuickMute)) return;

			const channelScoping = parseChannelScoping(quickMuteGuildConfig.channel_scoping);
			if (!channelInScope(channel, channelScoping)) return;

			const target = await guild.members.fetch(messageAuthorId).catch(() => null);

			if (!target) return;

			if (target.isCommunicationDisabled()) {
				return config.log(LoggingEvent.QuickMuteResult, {
					content: `${executor}, ${target} is already muted.`
				});
			}

			if (!channel.permissionsFor(guild.members.me!).has("ModerateMembers")) {
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

			const formattedDuration = ms(Number(quickMuteConfig.duration), { long: true });

			try {
				await target.timeout(Number(quickMuteConfig.duration), truncatedReason);
			} catch (error) {
				const sentryId = captureException(error, {
					user: {
						id: target.user.id,
						username: target.user.username
					},
					extra: {
						action: "Quick Mute",
						duration: formattedDuration,
						executorId: executor.id,
						executorUsername: executor.user.username
					}
				});

				return config.log(LoggingEvent.QuickMuteResult, {
					content: `${executor}, an error occurred while executing quick mute on ${target}. Please use this ID when reporting the bug: \`${sentryId}\`.`
				});
			}

			// Handle message deletion/purge
			let purgeResult: QuickPurgeResult | null = null;

			const purgeAmount = Math.min(
				quickMuteConfig.purge_amount,
				quickMuteGuildConfig.purge_limit
			);

			if (purgeAmount > 1) {
				purgeResult = await Raw._executePurge({
					channel,
					authorId: messageAuthorId,
					triggerMessageId: messageId,
					amount: purgeAmount
				});
			} else {
				await channel.messages.delete(messageId).catch(() => null);
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
					? `${executor}, successfully quick muted ${target} for \`${formattedDuration}\` and purged \`${purgeResult.deleted}\`/\`${purgeAmount}\` ${inflect(purgeResult.deleted, "message")} in ${channel}.`
					: `${executor}, successfully quick muted ${target} for \`${formattedDuration}\`.`;

			if (purgeResult?.ok && purgeResult.deleted > 0) {
				const entries = purgeResult.entries ?? [];
				const attachment = Raw._mapLogEntriesToFile(entries);
				const components: ActionRowBuilder<ButtonBuilder>[] = [];

				if (purgeResult.logUrl) {
					const button = new ButtonBuilder()
						.setLabel("Open In Browser")
						.setStyle(ButtonStyle.Link)
						.setURL(purgeResult.logUrl);

					const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
					components.push(row);
				}

				metrics.count(SENTRY_METRICS_COUNTERS.QuickMuteExecuted, 1, {
					attributes: {
						guild_id: guildId,
						target_id: target.id,
						executor_id: executor.id,
						mute_duration: formattedDuration,
						purged_messages: purgeResult.deleted.toString(),
						requested_purge_amount: purgeAmount.toString()
					}
				});

				return Promise.all([
					config.log(LoggingEvent.QuickMuteExecuted, { embeds: [embed] }),
					config.log(LoggingEvent.QuickMuteResult, {
						content,
						components,
						files: [attachment]
					})
				]);
			}

			metrics.count(SENTRY_METRICS_COUNTERS.QuickMuteExecuted, 1, {
				attributes: {
					guild_id: guildId,
					target_id: target.id,
					executor_id: executor.id,
					mute_duration: formattedDuration
				}
			});

			return Promise.all([
				config.log(LoggingEvent.QuickMuteExecuted, { embeds: [embed] }),
				config.log(LoggingEvent.QuickMuteResult, { content })
			]);
		} catch {
			quickMuteActionLocks.delete(messageAuthorId);
		} finally {
			quickMuteActionLocks.delete(messageAuthorId);
		}
	}

	/**
	 * Handles a quick purge reaction event.
	 *
	 * @param data The data for handling the quick purge.
	 * @returns A promise that resolves when the quick purge handling is complete.
	 */

	private static async _handleQuickPurge(data: ResolvedReactionContext): Promise<unknown> {
		const { reactorId, messageId, messageAuthorId, guildId, emoji, guild, channel, config } =
			data;

		if (quickPurgeActionLocks.has(messageAuthorId)) return;
		quickPurgeActionLocks.add(messageAuthorId);

		try {
			const quickPurgeGuildConfig = config.parseQuickActionConfig("quick_purges");
			if (!quickPurgeGuildConfig) return;

			const reactionIdentifier = getEmojiIdentifier(emoji);
			if (!reactionIdentifier) return;

			const quickPurgeConfig = await kysely
				.selectFrom("QuickPurge")
				.where("user_id", "=", reactorId)
				.where("guild_id", "=", guildId)
				.where("reaction", "=", reactionIdentifier)
				.selectAll()
				.executeTakeFirst();

			if (!quickPurgeConfig) return;

			const executor = await guild.members.fetch(reactorId).catch(() => null);
			if (!executor) return;

			// Prevent people who had access to quick purges but lost it from executing quick purges.
			if (!config.hasPermission(executor, UserPermission.UseQuickPurge)) return;

			const channelScoping = parseChannelScoping(quickPurgeGuildConfig.channel_scoping);
			if (!channelInScope(channel, channelScoping)) return;

			const target = await guild.members.fetch(messageAuthorId).catch(() => null);
			if (!target) return;

			if (!channel.permissionsFor(executor).has("ManageMessages")) {
				return config.log(LoggingEvent.QuickPurgeResult, {
					content: `${executor}, you do not have permission to manage messages in ${channel}.`
				});
			}

			if (!channel.permissionsFor(guild.members.me!).has("ManageMessages")) {
				return config.log(LoggingEvent.QuickPurgeResult, {
					content: `${executor}, I do not have permission to manage messages in ${channel}, which is required to purge messages.`
				});
			}

			const purgeAmount = Math.min(
				quickPurgeConfig.purge_amount,
				quickPurgeGuildConfig.max_limit
			);

			const purgeResult = await Raw._executePurge({
				channel,
				authorId: messageAuthorId,
				triggerMessageId: messageId,
				amount: purgeAmount
			});

			if (!purgeResult.ok || purgeResult.deleted === 0) {
				return config.log(LoggingEvent.QuickPurgeResult, {
					content: `${executor}, failed to quick purge messages for ${target}: ${purgeResult.message}`
				});
			}

			const entries = purgeResult.entries ?? [];
			const attachment = Raw._mapLogEntriesToFile(entries);
			const components: ActionRowBuilder<ButtonBuilder>[] = [];
			const hasteURL = purgeResult.logUrl ?? null;

			const content = `${executor}, successfully purged \`${purgeResult.deleted}\`/\`${purgeAmount}\` ${inflect(purgeResult.deleted, "message")} from ${target} in ${channel}.`;

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
						value: `<#${channel.id}>`
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

			metrics.count(SENTRY_METRICS_COUNTERS.QuickPurgeExecuted, 1, {
				attributes: {
					guild_id: guildId,
					target_id: target.id,
					executor_id: executor.id,
					purged_messages: purgeResult.deleted.toString(),
					requested_purge_amount: purgeAmount.toString()
				}
			});

			return Promise.all([
				config.log(LoggingEvent.QuickPurgeExecuted, { embeds: [embed] }),
				config.log(LoggingEvent.QuickPurgeResult, {
					content,
					components,
					files: [attachment]
				})
			]);
		} catch {
			quickPurgeActionLocks.delete(messageAuthorId);
		} finally {
			quickPurgeActionLocks.delete(messageAuthorId);
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
		triggerMessageId: Snowflake;
		amount: number;
	}): Promise<QuickPurgeResult> {
		const { channel, authorId, triggerMessageId, amount } = data;

		const messageIds = await Raw._fetchPurgeableMessages({
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
				const messageTimestamp = Raw._snowflakeToTimestamp(id);
				const age = now - messageTimestamp;

				if (age < BULK_DELETE_MAX_AGE) {
					bulkDeletableIds.push(id);
				} else {
					individualDeletableIds.push(id);
				}
			}

			let deleted = 0;
			let failed = 0;

			// Remove the trigger message from deletion lists since we delete it separately.
			const triggerIdx1 = bulkDeletableIds.indexOf(triggerMessageId);
			if (triggerIdx1 !== -1) bulkDeletableIds.splice(triggerIdx1, 1);

			const triggerIdx2 = individualDeletableIds.indexOf(triggerMessageId);
			if (triggerIdx2 !== -1) individualDeletableIds.splice(triggerIdx2, 1);

			// Start serializing messages early (doesn't depend on deletions).
			const serializedMessagesPromise = MessageManager.bulkDelete(messageIds);

			// Delete trigger message and bulk/individual messages concurrently.
			const deleteOperations: Promise<{ deleted: number; failed: number }>[] = [];

			deleteOperations.push(
				channel.messages.delete(triggerMessageId).then(
					() => ({ deleted: 1, failed: 0 }),
					() => ({ deleted: 0, failed: 1 })
				)
			);

			if (bulkDeletableIds.length > 0) {
				deleteOperations.push(Raw._bulkDeleteMessages(channel, bulkDeletableIds));
			}

			if (individualDeletableIds.length > 0) {
				deleteOperations.push(
					Raw._individualDeleteMessages(channel, individualDeletableIds)
				);
			}

			const deleteResults = await Promise.all(deleteOperations);

			for (const result of deleteResults) {
				deleted += result.deleted;
				failed += result.failed;
			}

			// Await serialized messages (likely already resolved by now).
			const serializedMessages = await serializedMessagesPromise;

			// Generate log entries and upload to hastebin concurrently.
			const entries = await Raw._getMessageLogEntries(serializedMessages);
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
				const individualResult = await Raw._individualDeleteMessages(channel, chunk);
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
				batch.map(id => Raw._deleteMessage(channel, id))
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
	 * Deletes directly via the API without fetching the message first.
	 * Returns true if successful, false otherwise.
	 */
	private static async _deleteMessage(
		channel: TextChannel,
		messageId: Snowflake
	): Promise<boolean> {
		try {
			await channel.messages.delete(messageId);
			return true;
		} catch {
			// Message might already be deleted or we lack permissions.
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
		// Pre-fetch all unique authors in parallel.
		const uniqueAuthorIds = new Set<Snowflake>();

		for (const message of messages) {
			uniqueAuthorIds.add(message.author_id);
		}

		const authorCache = new Map<Snowflake, User | { username: string; id: Snowflake }>();

		await Promise.all(
			[...uniqueAuthorIds].map(async authorId => {
				const author = await client.users.fetch(authorId).catch(() => ({
					username: "unknown user",
					id: authorId
				}));
				authorCache.set(authorId, author);
			})
		);

		// Fetch all references in parallel.
		const referenceIds = messages
			.map(m => m.reference_id)
			.filter((id): id is string => id !== null);

		const referenceCache = new Map<string, SerializedMessage>();

		if (referenceIds.length > 0) {
			const references = await MessageManager.getMany(referenceIds);

			for (let i = 0; i < referenceIds.length; i++) {
				const ref = references[i];
				if (ref) {
					referenceCache.set(referenceIds[i], ref);

					// Ensure reference authors are also cached.
					if (!authorCache.has(ref.author_id)) {
						const author = await client.users.fetch(ref.author_id).catch(() => ({
							username: "unknown user",
							id: ref.author_id
						}));
						authorCache.set(ref.author_id, author);
					}
				}
			}
		}

		// Build all entries in parallel (everything is now cached).
		const entryPromises = messages.map(async message => {
			const author = authorCache.get(message.author_id)!;
			const mainEntry = await Raw._formatMessageLogEntry({
				author,
				messageId: message.id,
				createdAt: message.created_at,
				stickerId: null,
				messageContent: message.content,
				messageAttachments: message.attachments
			});

			const subEntries = [mainEntry];

			if (message.reference_id) {
				const reference = referenceCache.get(message.reference_id);

				if (reference) {
					const refAuthor = authorCache.get(reference.author_id)!;
					const refEntry = await Raw._formatMessageLogEntry({
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

			return {
				entry: subEntries.join("\n └── "),
				createdAt: message.created_at
			};
		});

		const entries = await Promise.all(entryPromises);

		authorCache.clear();

		return entries
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.map(({ entry }) => entry);
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
}
