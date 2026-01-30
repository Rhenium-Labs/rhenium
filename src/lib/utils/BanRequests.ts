import {
	type User,
	type GuildMember,
	type ButtonInteraction,
	type ModalSubmitInteraction,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	MessageFlags,
	roleMention,
	userMention,
	WebhookClient
} from "discord.js";

import ms from "ms";

import { RequestStatus } from "#kysely/Enums.js";
import { client, kysely } from "#root/index.js";
import { userMentionWithId } from "./index.js";

import type { BanRequest } from "#kysely/Schema.js";
import type { InteractionReplyData } from "./Types.js";
import type { ValidatedBanRequestsConfig } from "#config/GuildConfig.js";

export default class BanRequestUtils {
	/**
	 * Creates a ban request and sends it to the configured webhook for review.
	 *
	 * @param data The ban request data.
	 * @return Interaction reply data indicating success or failure.
	 */

	public static async create(data: {
		config: ValidatedBanRequestsConfig;
		target: User;
		executor: GuildMember;
		duration: bigint | null;
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
			embed.spliceFields(2, 0, { name: "Duration", value: ms(Number(duration), { long: true }) });
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
			.setStyle(ButtonStyle.Primary)
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

		const webhook = new WebhookClient({ url: config.webhook_url });
		const content =
			config.notify_roles.length > 0 ? config.notify_roles.map(r => roleMention(r)).join(", ") : undefined;

		const log = await webhook
			.send({
				content,
				embeds: [embed],
				components: [actionRow],
				allowedMentions: { parse: ["roles"] }
			})
			.catch(() => null);

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

		void kysely
			.insertInto("BanRequest")
			.values({
				id: log.id,
				guild_id: config.id,
				target_id: target.id,
				target_muted_automatically: muted,
				requested_by: executor.id,
				duration,
				reason
			})
			.execute()
			.then(() => webhook.destroy());

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
		config: ValidatedBanRequestsConfig;
		action: BanRequestAction;
		request: BanRequest;
		reviewReason: string | null;
	}): Promise<InteractionReplyData> {
		const { interaction, action, request, reviewReason, config } = data;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const target = await client.users.fetch(request.target_id).catch(() => null);
		const targetMember = await interaction.guild.members.fetch(request.target_id).catch(() => null);

		switch (action) {
			case BanRequestAction.Disregard: {
				if (request.target_muted_automatically) {
					await targetMember
						?.timeout(null, `[${request.id}] Automatic unmute after ban request disregard`)
						.catch(() => null);
				}

				void Promise.all([
					BanRequestUtils._log({
						config,
						action,
						interaction,
						reason: reviewReason
					}),
					kysely
						.updateTable("BanRequest")
						.set({
							resolved_by: interaction.user.id,
							resolved_at: new Date(),
							status: RequestStatus.Disregarded
						})
						.where("id", "=", request.id)
						.execute(),
					interaction.message?.delete().catch(() => null)
				]);

				return {
					content: `Successfully disregarded the ban request for ${userMention(request.target_id)} - ID \`${request.id}\``
				};
			}

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
					void kysely
						.insertInto("TemporaryBan")
						.values({
							guild_id: interaction.guild.id,
							target_id: target.id,
							expires_at: expiresAt
						})
						.onConflict(oc =>
							oc.columns(["guild_id", "target_id"]).doUpdateSet({
								expires_at: expiresAt
							})
						)
						.execute();
				}

				void Promise.all([
					BanRequestUtils._notify({
						webhook_url: config.decision_webhook_url,
						reviewReason,
						action,
						request
					}),
					BanRequestUtils._log({
						config,
						action,
						interaction,
						reason: reviewReason
					}),
					kysely
						.updateTable("BanRequest")
						.set({
							status: RequestStatus.Accepted,
							resolved_by: interaction.user.id,
							resolved_at: new Date()
						})
						.where("id", "=", request.id)
						.execute(),
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

				void Promise.all([
					BanRequestUtils._notify({
						webhook_url: config.decision_webhook_url,
						reviewReason,
						action,
						request
					}),
					BanRequestUtils._log({
						config,
						action,
						interaction,
						reason: reviewReason
					}),
					kysely
						.updateTable("BanRequest")
						.set({
							status: RequestStatus.Denied,
							resolved_by: interaction.user.id,
							resolved_at: new Date()
						})
						.where("id", "=", request.id)
						.execute(),
					interaction.message?.delete().catch(() => null)
				]);

				return {
					content: `Successfully denied the ban request for ${target} - ID \`${request.id}\``
				};
			}
		}
	}

	/**
	 * Notifies the requester about the outcome of their ban request.
	 *
	 * @param data The notification data.
	 * @return The result of the notification.
	 */

	private static async _notify(data: {
		webhook_url: string | null;
		reviewReason: string | null;
		action: Exclude<BanRequestAction, "Disregard">;
		request: BanRequest;
	}): Promise<any> {
		const { webhook_url, reviewReason, action, request } = data;

		if (!webhook_url) return null;

		const formattedReason = reviewReason ? reviewReason.replaceAll("`", "") : null;
		const content = `${userMention(request.requested_by)}, your ban request against ${userMentionWithId(
			request.target_id
		)} has been ${PastTenseBanRequestAction[action].toLowerCase()}${formattedReason ? ` - ${formattedReason}` : "."}`;

		const webhook = new WebhookClient({ url: webhook_url });
		return webhook
			.send({ content, allowedMentions: { parse: ["users"] } })
			.catch(() => null)
			.then(() => webhook.destroy());
	}

	/**
	 * Sends a log message to the specified webhook.
	 *
	 * @param data The log data.
	 * @return The sent API message, or `null` if sending failed.
	 */

	private static async _log(data: {
		config: ValidatedBanRequestsConfig;
		action: BanRequestAction;
		interaction: ButtonInteraction<"cached"> | ModalSubmitInteraction<"cached">;
		reason: string | null;
	}): Promise<any> {
		const { config, action, interaction, reason } = data;

		if (!config.log_webhook_url) return null;

		const color = BanRequestColors[action];
		const pastTenseAction = PastTenseBanRequestAction[action];

		const embed = new EmbedBuilder(interaction.message!.embeds[0].data)
			.setColor(color)
			.setAuthor({ name: `Ban Request ${pastTenseAction}` })
			.setFooter({
				text: `Reviewed by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		if (reason) {
			embed.addFields({ name: "Reviewer Reason", value: reason });
		}

		const webhook = new WebhookClient({ url: config.log_webhook_url });
		return webhook
			.send({ embeds: [embed], allowedMentions: { parse: [] } })
			.catch(() => null)
			.then(() => webhook.destroy());
	}
}

const BanRequestColors = {
	Deny: Colors.Red,
	Accept: Colors.Green,
	Disregard: Colors.NotQuiteBlack
} as const;

const PastTenseBanRequestAction = {
	Deny: "Denied",
	Accept: "Accepted",
	Disregard: "Disregarded"
} as const;

export const BanRequestAction = {
	Deny: "Deny",
	Accept: "Accept",
	Disregard: "Disregard"
} as const;
export type BanRequestAction = (typeof BanRequestAction)[keyof typeof BanRequestAction];
