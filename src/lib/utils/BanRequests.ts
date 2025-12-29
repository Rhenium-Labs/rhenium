import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	GuildMember,
	MessageFlags,
	ModalSubmitInteraction,
	roleMention,
	User,
	userMention,
	WebhookClient
} from "discord.js";

import ms from "ms";

import { client, prisma } from "#root/index.js";
import { userMentionWithId } from "./index.js";
import { RequestStatus, type BanRequest, type BanRequestConfig } from "#prisma/client.js";

import type { InteractionReplyData, SimpleResult } from "./Types.js";

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

		let muted: boolean = false;

		if (config.automatically_timeout) {
			const targetMember = await executor.guild.members.fetch(target.id).catch(() => null);

			if (targetMember) {
				muted = await targetMember
					.timeout(ms("28d"), `Automatic timeout for ban request review - ID ${log.id}`)
					.catch(() => false)
					.then(() => true);
			}
		}

		await prisma.banRequest.create({
			data: {
				id: log.id,
				guild_id: config.id,
				target_id: target.id,
				target_muted_automatically: muted,
				requested_by: executor.id,
				duration,
				reason
			}
		});

		return {
			content: `Successfully submitted a ban request for ${target} - ID \`${log.id}\`.`
		};
	}

	/**
	 * Handles accepting, denying, or disregarding a ban request.
	 *
	 * @param data The ban request action data.
	 * @return The result of the ban request action.
	 */

	public static async process(data: {
		interaction: ButtonInteraction<"cached"> | ModalSubmitInteraction<"cached">;
		config: BanRequestConfig;
		action: Exclude<BanRequestAction, "disregard">;
		request: BanRequest;
		reviewReason: string | null;
	}): Promise<InteractionReplyData> {
		const { interaction, action, request, reviewReason } = data;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const target = await client.users.fetch(request.target_id).catch(() => null);
		const targetMember = await interaction.guild.members.fetch(request.target_id).catch(() => null);

		switch (action) {
			case BanRequestAction.Accept: {
				if (!target) {
					return {
						error: `Failed to fetch the target user, cannot proceed with ban.`
					};
				}

				if (await interaction.guild.bans.fetch(target.id).catch(() => null)) {
					return {
						error: `The target user is already banned. Unban them before accepting this request.`
					};
				}

				const currentDate = Date.now();
				const expiresAt = request.duration ? new Date(currentDate + Number(request.duration)) : null;

				const banned = await interaction.guild.bans
					.create(target, {
						reason: `[${request.id}] Ban request accepted by ${interaction.user.tag} (${interaction.user.id}) - ${request.reason}`
					})
					.catch(() => null);

				if (!banned) {
					return {
						error: `Failed to ban the target user. Do I have the necessary permissions?`
					};
				}

				if (expiresAt) {
					await prisma.temporaryBan.upsert({
						where: { guild_id_target_id: { guild_id: interaction.guild.id, target_id: target.id } },
						create: { guild_id: interaction.guild.id, target_id: target.id, expires_at: expiresAt },
						update: { expires_at: expiresAt }
					});
				}

				Promise.all([
					BanRequestUtils.sendNotification({
						webhook_url: data.config.webhook_url,
						target_id: request.target_id,
						requested_by: request.requested_by,
						reviewReason,
						action
					}),
					prisma.banRequest.update({
						where: { id: request.id },
						data: {
							status: RequestStatus.Accepted,
							resolved_by: interaction.user.id,
							resolved_at: new Date()
						}
					}),
					interaction.message?.delete().catch(() => null)
				]);

				return {
					content: `Successfully accepted the ban request for ${target} - ID \`${request.id}\``
				};
			}

			case BanRequestAction.Deny: {
				if (targetMember && request.target_muted_automatically) {
					await targetMember
						.timeout(null, `Automatic unmute after ban request denial - ID ${request.id}`)
						.catch(() => null);
				}

				Promise.all([
					BanRequestUtils.sendNotification({
						webhook_url: data.config.webhook_url,
						target_id: request.target_id,
						requested_by: request.requested_by,
						reviewReason,
						action
					}),
					prisma.banRequest.update({
						where: { id: request.id },
						data: {
							status: RequestStatus.Denied,
							resolved_by: interaction.user.id,
							resolved_at: new Date()
						}
					}),
					interaction.message?.delete().catch(() => null)
				]);

				return {
					content: `Successfully denied the ban request for ${target} - ID \`${request.id}\``
				};
			}
		}
	}

	/**
	 * Disregards a ban request.
	 *
	 * @param data The ban request disregard data.
	 * @return The result of the ban request disregard.
	 */

	public static async disregard(data: {
		interaction: ButtonInteraction<"cached">;
		request: BanRequest;
	}): Promise<InteractionReplyData> {
		const { interaction, request } = data;

		const targetMember = await interaction.guild.members.fetch(request.target_id).catch(() => null);

		if (targetMember && request.target_muted_automatically) {
			await targetMember
				.timeout(null, `Automatic unmute after ban request disregard - ID ${request.id}`)
				.catch(() => null);
		}

		await prisma.banRequest.update({
			where: { id: request.id },
			data: {
				resolved_by: interaction.user.id,
				resolved_at: new Date(),
				status: RequestStatus.Disregarded
			}
		});

		await interaction.message.delete().catch(() => null);

		return {
			content: `Successfully disregarded the ban request for ${userMention(request.target_id)} - ID \`${request.id}\``
		};
	}

	/**
	 * Notifies the requester about the outcome of their ban request.
	 *
	 * @param data The notification data.
	 * @return The result of the notification.
	 */

	public static async sendNotification(data: {
		webhook_url: string | null;
		target_id: string;
		requested_by: string;
		reviewReason: string | null;
		action: Exclude<BanRequestAction, "disregard">;
	}): Promise<SimpleResult> {
		const { webhook_url, requested_by, reviewReason, action, target_id } = data;

		if (!webhook_url) return { ok: false, message: "No webhook URL provided." };

		const formattedReason = reviewReason ? reviewReason.replaceAll("`", "") : null;
		const content = `${userMention(requested_by)}, your ban request against ${userMentionWithId(
			target_id
		)} has been ${action === BanRequestAction.Accept ? "accepted" : "denied"}${formattedReason ? ` - ${formattedReason}` : "."}`;

		return new WebhookClient({ url: webhook_url })
			.send({ content, allowedMentions: { parse: ["users"] } })
			.then(() => ({ ok: true as const }))
			.catch(() => ({ ok: false, message: `Failed to send notification.` }));
	}
}

export const BanRequestAction = {
	Accept: "accept",
	Deny: "deny",
	Disregard: "disregard"
} as const;
export type BanRequestAction = (typeof BanRequestAction)[keyof typeof BanRequestAction];
