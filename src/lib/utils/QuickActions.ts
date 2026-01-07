import {
	type User,
	type Message,
	type Snowflake,
	type TextChannel,
	type MessageReaction,
	type WebhookMessageCreateOptions,
	Colors,
	EmbedBuilder,
	WebhookClient
} from "discord.js";

import ms from "ms";

import { prisma } from "#root/index.js";
import {
	channelInScope,
	getEmojiIdentifier,
	inflect,
	parseChannelScoping,
	sleep,
	truncate,
	userMentionWithId
} from "./index.js";
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

export type QuickPurgeResult = {
	ok: boolean;
	deleted: number;
	failed: number;
	message?: string;
};

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
				triggerMessageId: message.id,
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

		if (purgeResult && purgeResult.deleted > 0) {
			embed.addFields({
				name: "Messages Purged",
				value: `${purgeResult.deleted} ${inflect(purgeResult.deleted, "message")}${purgeResult.failed > 0 ? ` (${purgeResult.failed} failed)` : ""}`
			});
		}

		const logWebhook = new WebhookClient({ url: quickMuteGuildConfig.webhook_url });

		const successMessage =
			purgeResult && purgeResult.deleted > 0
				? `${executor}, successfully quick muted ${target} for \`${formattedDuration}\` and purged \`${purgeResult.deleted}\`/\`${purgeAmount}\` ${inflect(purgeResult.deleted, "message")} in ${message.channel}.`
				: `${executor}, successfully quick muted ${target} for \`${formattedDuration}\`.`;

		return Promise.all([
			logWebhook.send({ embeds: [embed] }).catch(() => null),
			resultWebhook.send({ content: successMessage }).catch(() => null)
		]);
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
			triggerMessageId: message.id,
			amount: purgeAmount
		});

		if (!purgeResult.ok || purgeResult.deleted === 0) {
			return temporaryReply(resultWebhook, {
				content: `${executor}, failed to quick purge messages for ${target}: ${purgeResult.message}`
			});
		}

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
					value: `${purgeResult.deleted} ${inflect(purgeResult.deleted, "message")}${purgeResult.failed > 0 ? ` (${purgeResult.failed} failed)` : ""}`
				}
			])
			.setTimestamp();

		const logWebhook = new WebhookClient({ url: quickPurgeGuildConfig.webhook_url });

		return Promise.all([
			logWebhook.send({ embeds: [embed] }).catch(() => null),
			resultWebhook
				.send({
					content: `${executor}, successfully purged \`${purgeResult.deleted}\`/\`${purgeAmount}\` ${inflect(purgeResult.deleted, "message")} from ${target} in ${message.channel}.`
				})
				.catch(() => null)
		]);
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

		try {
			const messageIds = await QuickActionUtils._fetchPurgeableMessages({
				channelId: channel.id,
				authorId,
				triggerMessageId,
				limit: amount
			});

			if (messageIds.length === 0) {
				return { ok: true, deleted: 0, failed: 0, message: "No messages found to purge." };
			}

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

			await prisma.message.updateMany({
				where: { id: { in: messageIds } },
				data: { deleted: true }
			});

			return { ok: true, deleted, failed };
		} catch (error) {
			return {
				ok: false,
				deleted: 0,
				failed: amount,
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
