import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	GuildMember,
	roleMention,
	User,
	WebhookClient
} from "discord.js";

import ms from "ms";

import { prisma } from "#root/index.js";
import { InteractionReplyData } from "./Types.js";
import { userMentionWithId } from "./index.js";
import type { BanRequestConfig } from "#prisma/client.js";

export default class BanRequestUtils {
	/**
	 * Creates a ban request and sends it to the configured webhook for review.
	 *
	 * @param data The ban request data.
	 * @return The result of the ban request creation.
	 */

	public static async create(data: {
		config: BanRequestConfig;
		target: User;
		executor: GuildMember;
		duration: number | null;
		reason: string;
	}): Promise<InteractionReplyData> {
		const { config, target, executor, duration, reason } = data;

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({ name: "New Ban Request" })
			.setThumbnail(target.displayAvatarURL())
			.setFields([
				{ name: "Target", value: userMentionWithId(target.id) },
				{ name: "Requested By", value: userMentionWithId(executor.id) },
				{ name: "Reason", value: reason }
			])
			.setTimestamp();

		if (duration) {
			embed.spliceFields(2, 0, { name: "Duration", value: ms(duration, { long: true }) });
		}

		const acceptButton = new ButtonBuilder()
			.setLabel("Accept")
			.setStyle(ButtonStyle.Success)
			.setCustomId(`ban-request-accept`);
		const denyButton = new ButtonBuilder()
			.setLabel("Deny")
			.setStyle(ButtonStyle.Danger)
			.setCustomId(`ban-request-deny`);
		const disregardButton = new ButtonBuilder()
			.setLabel("Disregard")
			.setStyle(ButtonStyle.Secondary)
			.setCustomId(`ban-request-disregard`);
		const userInfoButton = new ButtonBuilder()
			.setLabel("User Info")
			.setStyle(ButtonStyle.Secondary)
			.setCustomId(`user-info-${target.id}`);

		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			acceptButton,
			denyButton,
			disregardButton,
			userInfoButton
		);

		const webhook = new WebhookClient({ url: config.webhook_url! });
		const content =
			config.notify_roles.length > 0 ? config.notify_roles.map(r => roleMention(r)).join(", ") : undefined;

		const log = await webhook.send({
			content,
			embeds: [embed],
			components: [actionRow],
			allowedMentions: { parse: ["roles"] }
		});

		if (!log) {
			return {
				error: "Failed to submit ban request."
			};
		}

		if (config.automatically_timeout) {
			const targetMember = await executor.guild.members.fetch(target.id).catch(() => null);

			if (targetMember) {
				await targetMember
					.timeout(ms("28d"), `Automatic timeout for ban request review - ID ${log.id}`)
					.catch(() => null);
			}
		}

		await prisma.banRequest.create({
			data: {
				id: log.id,
				guild_id: config.id,
				target_id: target.id,
				requested_by: executor.id,
				duration,
				reason
			}
		});

		return {
			content: `Successfully submitted a ban request for ${target} - ID \`${log.id}\`.`
		};
	}
}
