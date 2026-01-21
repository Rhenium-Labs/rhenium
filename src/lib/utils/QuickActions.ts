import {
	type User,
	type Message,
	type Snowflake,
	type TextChannel,
	type MessageReaction,
	type WebhookMessageCreateOptions,
	Colors,
	EmbedBuilder,
	WebhookClient,
	StickerFormatType,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder
} from "discord.js";

import ms from "ms";

import { client, prisma } from "#root/index.js";
import { Message as SerializedMessage } from "#prisma/client.js";
import {
	channelInScope,
	getEmojiIdentifier,
	hastebin,
	inflect,
	parseChannelScoping,
	sleep,
	truncate,
	userMentionWithId
} from "./index.js";
import { LOG_DATE_FORMAT } from "./Constants.js";
import { MessageQueue } from "./Messages.js";

import ModerationUtils from "./Moderation.js";
import GuildConfig from "#managers/config/GuildConfig.js";

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

export default class QuickActionUtils {
	/**
	 * Handles a quick mute reaction event.
	 *
	 * @param data The data for handling the quick mute.
	 * @returns A promise that resolves when the quick mute handling is complete.
	 */

	public static async handleQuickMute(data: {
		user: User;
		message: Message<true>;
		reaction: MessageReaction;
		config: GuildConfig;
	}): Promise<unknown> {
		const { user, message, reaction, config } = data;

		if (quickMuteActionLocks.has(message.author.id)) return;
		quickMuteActionLocks.add(message.author.id);

		try {
			const quickMuteGuildConfig = config.getQuickMutesConfig();
			if (!quickMuteGuildConfig) return;

			const executor = await message.guild.members.fetch(user.id).catch(() => null);
			if (!executor) return;

			// Prevent people who had access to quick mutes but lost it from executing quick mutes.
			if (!config.hasPermission(executor, "UseQuickMute")) return;

			const channelScoping = parseChannelScoping(quickMuteGuildConfig.channel_scoping);
			if (!channelInScope(message.channel, channelScoping)) return;

			const reactionIdentifier = getEmojiIdentifier(reaction.emoji);
			if (!reactionIdentifier) return;

			const quickMuteConfig = await prisma.quickMute.findUnique({
				where: {
					user_id_guild_id_reaction: {
						user_id: user.id,
						guild_id: message.guildId,
						reaction: reactionIdentifier
					}
				}
			});

			if (!quickMuteConfig) return;

			const target = await message.guild.members.fetch(message.author.id).catch(() => null);
			if (!target) return;

			const resultWebhook = new WebhookClient({ url: quickMuteGuildConfig.result_webhook_url });

			if (target.isCommunicationDisabled()) {
				return temporaryReply(resultWebhook, {
					content: `${executor}, ${target} is already muted.`
				});
			}

			if (!executor.guild.members.me!.permissions.has("ModerateMembers")) {
				return temporaryReply(resultWebhook, {
					content: `${executor}, I do not have the "Timeout Members" permission which is required to mute ${target}.`
				});
			}

			const validationResult = ModerationUtils.validateAction({
				target,
				executor,
				action: "Quick Mute"
			});

			if (!validationResult.ok) {
				return temporaryReply(resultWebhook, {
					content: `${executor}, ${validationResult.message}`
				});
			}

			const truncatedReason = truncate(
				`Quick mute issued by @${executor.user.username} (${executor.id}) - ${quickMuteConfig.reason}`,
				512
			);
			const formattedDuration = ms(Number(quickMuteConfig.duration), { long: true });

			const result = await target
				.timeout(Number(quickMuteConfig.duration), truncatedReason)
				.then(() => ({ ok: true }))
				.catch(() => ({ ok: false }));

			if (!result.ok) {
				return temporaryReply(resultWebhook, {
					content: `${executor}, failed to quick mute ${target}.`
				});
			}

			// Handle message deletion/purge
			let purgeResult: QuickPurgeResult | null = null;

			const purgeAmount = Math.min(quickMuteConfig.purge_amount, quickMuteGuildConfig.purge_limit);

			if (purgeAmount > 1) {
				purgeResult = await QuickActionUtils._executePurge({
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

			const logWebhook = new WebhookClient({ url: quickMuteGuildConfig.webhook_url });

			const content =
				purgeResult && purgeResult.deleted > 0
					? `${executor}, successfully quick muted ${target} for \`${formattedDuration}\` and purged \`${purgeResult.deleted}\`/\`${purgeAmount}\` ${inflect(purgeResult.deleted, "message")} in ${message.channel}.`
					: `${executor}, successfully quick muted ${target} for \`${formattedDuration}\`.`;

			if (purgeResult) {
				const entries = purgeResult.entries ?? [];
				const attachment = QuickActionUtils._mapLogEntriesToFile(entries);
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
					logWebhook.send({ embeds: [embed] }).catch(() => null),
					resultWebhook
						.send({
							content,
							components,
							files: [attachment]
						})
						.catch(() => null)
				]);
			}

			return Promise.all([
				logWebhook.send({ embeds: [embed] }).catch(() => null),
				resultWebhook.send({ content }).catch(() => null)
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

	public static async handleQuickPurge(data: {
		user: User;
		message: Message<true>;
		reaction: MessageReaction;
		config: GuildConfig;
	}): Promise<unknown> {
		const { user, message, reaction, config } = data;

		if (quickPurgeActionLocks.has(message.author.id)) return;
		quickPurgeActionLocks.add(message.author.id);

		try {
			const quickPurgeGuildConfig = config.getQuickPurgesConfig();
			if (!quickPurgeGuildConfig) return;

			const executor = await message.guild.members.fetch(user.id).catch(() => null);
			if (!executor) return;

			// Prevent people who had access to quick purges but lost it from executing quick purges.
			if (!config.hasPermission(executor, "UseQuickPurge")) return;

			const channelScoping = parseChannelScoping(quickPurgeGuildConfig.channel_scoping);
			if (!channelInScope(message.channel, channelScoping)) return;

			const reactionIdentifier = getEmojiIdentifier(reaction.emoji);
			if (!reactionIdentifier) return;

			const quickPurgeConfig = await prisma.quickPurge.findUnique({
				where: {
					user_id_guild_id_reaction: {
						user_id: user.id,
						guild_id: message.guildId,
						reaction: reactionIdentifier
					}
				}
			});

			if (!quickPurgeConfig) return;

			const target = await message.guild.members.fetch(message.author.id).catch(() => null);
			if (!target) return;

			const resultWebhook = new WebhookClient({ url: quickPurgeGuildConfig.result_webhook_url });

			if (!message.channel.permissionsFor(executor).has("ManageMessages")) {
				return temporaryReply(resultWebhook, {
					content: `${executor}, you do not have permission to manage messages in ${message.channel}.`
				});
			}

			if (!executor.guild.members.me!.permissions.has("ManageMessages")) {
				return temporaryReply(resultWebhook, {
					content: `${executor}, I do not have permission to manage messages in ${message.channel}, which is required to purge messages.`
				});
			}

			const purgeAmount = Math.min(quickPurgeConfig.purge_amount, quickPurgeGuildConfig.max_limit);

			const purgeResult = await QuickActionUtils._executePurge({
				channel: message.channel as TextChannel,
				authorId: message.author.id,
				triggerMessage: message,
				amount: purgeAmount
			});

			if (!purgeResult.ok || purgeResult.deleted === 0) {
				return temporaryReply(resultWebhook, {
					content: `${executor}, failed to quick purge messages for ${target}: ${purgeResult.message}`
				});
			}

			const entries = purgeResult.entries ?? [];
			const attachment = QuickActionUtils._mapLogEntriesToFile(entries);
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

			const logWebhook = new WebhookClient({ url: quickPurgeGuildConfig.webhook_url });

			return Promise.all([
				logWebhook.send({ embeds: [embed] }).catch(() => null),
				resultWebhook
					.send({
						content,
						components,
						files: [attachment]
					})
					.catch(() => null)
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

		const messageIds = await QuickActionUtils._fetchPurgeableMessages({
			channelId: channel.id,
			authorId,
			triggerMessageId: triggerMessage.id,
			limit: amount
		});

		try {
			if (messageIds.length === 0) {
				return { ok: true, deleted: 0, failed: 0, message: "No messages found to purge.", entries: [] };
			}

			// Add message IDs to exclusion set before deleting to prevent
			// duplicate handling from MessageDelete/MessageBulkDelete events.
			MessageQueue.addPurgeExclusions(messageIds);

			const now = Date.now();
			const bulkDeletableIds: Snowflake[] = [];
			const individualDeletableIds: Snowflake[] = [];

			for (const id of messageIds) {
				const messageTimestamp = QuickActionUtils._snowflakeToTimestamp(id);
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

			if (bulkDeletableIds.length > 0) {
				const bulkResult = await QuickActionUtils._bulkDeleteMessages(channel, bulkDeletableIds);
				deleted += bulkResult.deleted;
				failed += bulkResult.failed;
			}

			if (individualDeletableIds.length > 0) {
				const individualResult = await QuickActionUtils._individualDeleteMessages(
					channel,
					individualDeletableIds
				);
				deleted += individualResult.deleted;
				failed += individualResult.failed;
			}

			const serializedMessages = await MessageQueue.bulkDeleteMessages(messageIds);
			const entries = await QuickActionUtils._getMessageLogEntries(serializedMessages);
			const logUrl = (await hastebin(entries.join("\n\n"))) ?? undefined;

			// Remove exclusions after purge execution is complete.
			MessageQueue.removePurgeExclusions(messageIds);

			return { ok: true, deleted, failed, entries, logUrl };
		} catch (error) {
			// Make sure to clean up exclusions even on error.
			MessageQueue.removePurgeExclusions(messageIds);

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
	 * Returns messages in reverse chronological order, starting from the trigger message.
	 */
	private static async _fetchPurgeableMessages(data: {
		channelId: Snowflake;
		authorId: Snowflake;
		triggerMessageId: Snowflake;
		limit: number;
	}): Promise<Snowflake[]> {
		const { channelId, authorId, triggerMessageId, limit } = data;

		const cachedMessages = MessageQueue.getMessagesForPurge({
			channelId,
			authorId,
			triggerMessageId,
			limit
		});

		if (cachedMessages.length >= limit) {
			return cachedMessages.slice(0, limit);
		}

		const remaining = limit - cachedMessages.length;
		const cachedIds = new Set(cachedMessages);

		const oldestCachedId =
			cachedMessages.length > 0 ? cachedMessages[cachedMessages.length - 1] : triggerMessageId;

		const dbMessages = await prisma.message.findMany({
			where: {
				channel_id: channelId,
				author_id: authorId,
				deleted: false,
				// Only fetch messages older than our cached ones.
				id: { lt: oldestCachedId }
			},
			orderBy: { created_at: "desc" },
			take: remaining,
			select: { id: true }
		});

		const dbMessageIds = dbMessages.map(m => m.id).filter(id => !cachedIds.has(id));
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
				const individualResult = await QuickActionUtils._individualDeleteMessages(channel, chunk);
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

			const results = await Promise.allSettled(batch.map(id => QuickActionUtils._deleteMessage(channel, id)));

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
	private static async _deleteMessage(channel: TextChannel, messageId: Snowflake): Promise<boolean> {
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
			const mainEntry = await QuickActionUtils._formatMessageLogEntry({
				author,
				messageId: message.id,
				createdAt: message.created_at,
				stickerId: null,
				messageContent: message.content
			});

			const subEntries = [mainEntry];

			// Handle message reference if it exists.
			if (message.reference_id) {
				const reference = await MessageQueue.getMessage(message.reference_id);

				if (reference) {
					const refAuthor = await getAuthor(reference.author_id);
					const refEntry = await QuickActionUtils._formatMessageLogEntry({
						author: refAuthor,
						messageId: reference.id,
						createdAt: reference.created_at,
						stickerId: null,
						messageContent: reference.content
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
		return `[${data.messageId}] [${timestamp}] @${author.username} (${author.id}) - ${content}`;
	}
}

/**
 * Sends a temporary reply using a webhook that deletes itself after a short duration.
 *
 * @param webhook The webhook client to use for sending the message.
 * @param options The optionns for the message.
 * @returns A promise that resolves when the message has been sent and scheduled for deletion.
 */

export async function temporaryReply(webhook: WebhookClient, options: WebhookMessageCreateOptions): Promise<void> {
	const message = await webhook.send(options).catch(() => null);
	if (!message) return;

	setTimeout(async () => {
		await webhook.deleteMessage(message.id).catch(() => null);
	}, 7500);
}

type QuickPurgeResult = {
	ok: boolean;
	deleted: number;
	failed: number;
	entries: string[];
	message?: string;
	logUrl?: string;
};
