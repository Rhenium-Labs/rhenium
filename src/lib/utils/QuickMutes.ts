import { Colors, EmbedBuilder, Message, MessageReaction, User, WebhookClient } from "discord.js";

import ms from "ms";

import { prisma } from "#root/index.js";
import { channelInScope, getEmojiIdentifier, truncate, userMentionWithId } from "./index.js";

import type { ChannelScoping } from "./Types.js";

import ModerationUtils from "./Moderation.js";

export default class QuickMuteUtils {
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
	}): Promise<unknown> {
		const { user, message, reaction } = data;

		const quickMuteGuildConfig = await prisma.quickMuteConfig.findUnique({
			where: { id: message.guildId },
			include: { channel_scoping: true }
		});

		if (
			!quickMuteGuildConfig?.enabled ||
			!quickMuteGuildConfig.webhook_url ||
			!quickMuteGuildConfig.result_webhook_url
		) {
			return;
		}

		const channelScoping = quickMuteGuildConfig.channel_scoping.reduce<ChannelScoping>(
			(acc, channel) => {
				if (channel.type === 0) {
					acc.include_channels.push(channel.channel_id);
				} else {
					acc.exclude_channels.push(channel.channel_id);
				}

				return acc;
			},
			{
				include_channels: [],
				exclude_channels: []
			}
		);

		if (!channelInScope(message.channel, channelScoping)) {
			return;
		}

		const reactionIdentifier = getEmojiIdentifier(reaction.emoji);

		if (!reactionIdentifier) {
			return;
		}

		const quickMuteConfig = await prisma.quickMute.findUnique({
			where: {
				user_id_guild_id_reaction: {
					user_id: user.id,
					guild_id: message.guildId,
					reaction: reactionIdentifier
				}
			}
		});

		if (!quickMuteConfig) {
			return;
		}

		const target = await message.guild.members.fetch(message.author.id).catch(() => null);
		const executor = await message.guild.members.fetch(user.id).catch(() => null);

		if (!target || !executor) {
			return;
		}

		const resultWebhook = new WebhookClient({ url: quickMuteGuildConfig.result_webhook_url });

		if (target.isCommunicationDisabled()) {
			return resultWebhook.send({
				content: `${executor}, ${target} is already muted.`
			});
		}

		if (!executor.guild.members.me!.permissions.has("ModerateMembers")) {
			return resultWebhook.send({
				content: `${executor}, I do not have the "Timeout Members" permission which is required to mute ${target}.`
			});
		}

		const validationResult = ModerationUtils.validateAction({
			target,
			executor,
			action: "Quick Mute"
		});

		if (!validationResult.ok) {
			return resultWebhook.send({
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
			return resultWebhook
				.send({
					content: `${executor}, failed to quick mute ${target}.`
				})
				.catch(() => null);
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

		const logWebhook = new WebhookClient({ url: quickMuteGuildConfig.webhook_url });

		return Promise.all([
			logWebhook.send({ embeds: [embed] }).catch(() => null),
			resultWebhook
				.send({ content: `${executor}, successfully quick muted ${target} for \`${formattedDuration}\`.` })
				.catch(() => null)
		]);
	}
}
