import {
	type ButtonInteraction,
	type ColorResolvable,
	type GuildMember,
	type ModalSubmitInteraction,
	type User,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	roleMention,
	time,
	userMention,
	WebhookClient
} from "discord.js";

import ms from "ms";

import { kysely } from "@root/index";
import { RequestStatus } from "@repo/db";
import { LoggingEvent, UserPermission } from "@config/Schema";
import { parseDurationString, userMentionWithId, validateDuration } from "./index";

import type { BanRequest, BanRequestUpdate } from "@repo/db";
import type { SimpleResult } from "./Types";

import GuildConfig from "@config/GuildConfig";
import ModerationUtils from "./Moderation";

export default class BanRequestUtils {
	/**
	 * Creates a ban request and sends it to the configured webhook for review.
	 *
	 * @param data The ban request data.
	 * @returns The result of the operation.
	 */

	static async create(data: {
		config: GuildConfig;
		target: User;
		executor: GuildMember;
		durationStr: string | null;
		reason: string | null;
	}): Promise<SimpleResult<{ id: string }>> {
		const { config, target, executor, durationStr, reason } = data;

		// prettier-ignore
		const targetMember = await executor.guild.members
            .fetch(target.id)
            .catch(() => null);

		const immuneRoles = config.data.ban_requests.immune_roles;
		const isImmune = targetMember
			? immuneRoles.some(role => targetMember.roles.cache.has(role))
			: false;

		if (isImmune)
			return {
				ok: false,
				message: "The target user is immune to ban requests."
			};

		const existingRequest = await kysely
			.selectFrom("BanRequest")
			.selectAll()
			.where("guild_id", "=", executor.guild.id)
			.where("target_id", "=", target.id)
			.where("status", "=", RequestStatus.Pending)
			.executeTakeFirst();

		if (existingRequest)
			return {
				ok: false,
				message: "There is already a pending ban request for this user."
			};

		if (durationStr && ms(durationStr as ms.StringValue) === undefined)
			return {
				ok: false,
				message: "The provided duration is invalid. Please provide a valid duration string (e.g., 1d, 12h, 30m)."
			};

		const duration = parseDurationString(durationStr);
		const expiresAt = duration ? new Date(Date.now() + duration) : null;

		if (duration) {
			const result = validateDuration({
				duration,
				minimum: "1s",
				maximum: ms(Number.MAX_SAFE_INTEGER)
			});

			if (!result.ok)
				return {
					ok: false,
					message: result.message
				};
		}

		// prettier-ignore
		const result = ModerationUtils.validateAction(
			target,
			executor,
			"Ban"
		);

		if (!result.ok)
			return {
				ok: false,
				message: result.message
			};

		if (!reason && config.data.ban_requests.enforce_submission_reason)
			return {
				ok: false,
				message: "A reason is required to submit a ban request in this server."
			};

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({ name: "New Ban Request" })
			.setThumbnail(target.displayAvatarURL())
			.setFields([
				{ name: "Target", value: userMentionWithId(target.id) },
				{ name: "Requested By", value: userMentionWithId(executor.id) },
				{ name: "Reason", value: reason ?? "No reason provided" }
			])
			.setTimestamp();

		if (duration) {
			embed.spliceFields(2, 0, {
				name: "Duration",
				value: ms(duration, { long: true })
			});
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

		const webhook = new WebhookClient({ url: config.data.ban_requests.webhook_url! });
		const content =
			config.data.ban_requests.notify_roles.length > 0
				? config.data.ban_requests.notify_roles.map(roleMention).join(", ")
				: undefined;

		const log = await webhook
			.send({
				content,
				embeds: [embed],
				components: [actionRow],
				allowedMentions: { parse: ["roles"] }
			})
			.catch(() => null);

		if (!log)
			return {
				ok: false,
				message: "Failed to submit ban request."
			};

		let muted: boolean = false;

		if (config.data.ban_requests.automatically_timeout && targetMember) {
			muted = await targetMember
				.timeout(ms("28d"), `Automatic timeout for ban request - ID ${log.id}`)
				.then(() => true)
				.catch(() => false);
		}

		await kysely
			.insertInto("BanRequest")
			.values({
				id: log.id,
				guild_id: executor.guild.id,
				target_id: target.id,
				target_muted_automatically: muted,
				requested_by: executor.id,
				expires_at: expiresAt,
				reason: reason ?? "No reason provided"
			})
			.execute()
			.then(() => webhook.destroy());

		return { ok: true, data: { id: log.id } };
	}

	/**
	 * Handles accepting, denying, or disregarding a ban request.
	 *
	 * @param data The ban request action data.
	 * @returns The result of the operation.
	 */

	static async handle(
		interaction: ButtonInteraction<"cached"> | ModalSubmitInteraction<"cached">,
		config: GuildConfig,
		action: BanRequestAction,
		reviewReason: string | null = null
	): Promise<SimpleResult> {
		if (!config.hasPermission(interaction.member, UserPermission.ReviewBanRequests))
			return { ok: false, message: "You don't have permission to review ban requests." };

		const request = await kysely
			.selectFrom("BanRequest")
			.selectAll()
			.where("id", "=", interaction.message!.id)
			.executeTakeFirst();

		if (!request) {
			interaction.message?.delete().catch(() => null);

			return {
				ok: false,
				message: `Ban request could not be found. It may have been deleted.`
			};
		}

		if (request.resolved_by) {
			interaction.message?.delete().catch(() => null);

			return {
				ok: false,
				message: `This request was resolved by ${userMentionWithId(request.resolved_by)} on ${time(request.resolved_at!, "F")}.`
			};
		}

		const targetUser = await interaction.client.users
			.fetch(request.target_id)
			.catch(() => null);

		const targetMember = await interaction.guild.members
			.fetch(request.target_id)
			.catch(() => null);

		switch (action) {
			case BanRequestAction.Disregard: {
				if (request.target_muted_automatically) {
					targetMember
						?.timeout(
							null,
							`Automatic unmute after ban request disregard - ID ${request.id}`
						)
						.catch(() => null);
				}

				// prettier-ignore
				BanRequestUtils
                    ._log(interaction, action, config)
                    .then(() => interaction.message?.delete().catch(() => null));

				await kysely
					.updateTable("BanRequest")
					.set({
						status: RequestStatus.Disregarded,
						expires_at: null,
						resolved_by: interaction.user.id,
						resolved_at: new Date()
					})
					.where("id", "=", request.id)
					.execute();

				return { ok: true };
			}

			case BanRequestAction.Accept: {
				if (!targetUser)
					return {
						ok: false,
						message: `Failed to fetch the target user, cannot proceed with ban.`
					};

				if (await interaction.guild.bans.fetch(targetUser.id).catch(() => null))
					return {
						ok: false,
						message: `The target user is already banned. Unban them before accepting this request.`
					};

				const banned = await interaction.guild.bans
					.create(targetUser, {
						reason: `[${request.id}] Ban request accepted by ${interaction.user.tag} (${interaction.user.id}) - ${request.reason}`
					})
					.catch(() => null);

				if (!banned)
					return {
						ok: false,
						message: `Failed to ban the target user. Do I have the necessary permissions?`
					};

				if (request.expires_at) {
					kysely
						.insertInto("TemporaryBan")
						.values({
							guild_id: interaction.guild.id,
							target_id: targetUser.id,
							expires_at: request.expires_at
						})
						.onConflict(oc =>
							oc.columns(["guild_id", "target_id"]).doUpdateSet({
								expires_at: request.expires_at!
							})
						)
						.execute();
				}

				// prettier-ignore
				BanRequestUtils
                    ._log(interaction, action, config)
                    .then(() => interaction.message?.delete().catch(() => null));
				BanRequestUtils._notify(config, action, request);

				const data: BanRequestUpdate = {
					status: RequestStatus.Accepted,
					resolved_by: interaction.user.id,
					resolved_at: new Date()
				};

				await kysely
					.updateTable("BanRequest")
					.set(data)
					.where("id", "=", request.id)
					.execute();

				return { ok: true };
			}

			case BanRequestAction.Deny: {
				if (targetMember && request.target_muted_automatically)
					targetMember
						.timeout(
							null,
							`Automatic unmute after ban request denial - ID ${request.id}`
						)
						.catch(() => null);

				// prettier-ignore
				BanRequestUtils
                    ._log(interaction, action, config, reviewReason)
                    .then(() => interaction.message?.delete().catch(() => null));
				BanRequestUtils._notify(config, action, request, reviewReason);

				const data: BanRequestUpdate = {
					status: RequestStatus.Denied,
					resolved_by: interaction.user.id,
					resolved_at: new Date()
				};

				await kysely
					.updateTable("BanRequest")
					.set(data)
					.where("id", "=", request.id)
					.execute();

				return { ok: true };
			}
		}
	}

	/**
	 * Notifies the requester about the outcome of their ban request.
	 *
	 * @param config The guild configuration.
	 * @param action The action taken.
	 * @param request The ban request.
	 * @param reviewReason The reason provided for the action.
	 */

	private static async _notify(
		config: GuildConfig,
		action: Exclude<BanRequestAction, "Disregard">,
		request: BanRequest,
		reviewReason: string | null = null
	): Promise<void> {
		if (!config.canLogEvent(LoggingEvent.BanRequestResult)) return;

		const formattedReason = reviewReason ? reviewReason.replaceAll("`", "") : null;
		const formattedAction = REQUEST_ACTION_TO_PAST_TENSE[action].toLowerCase();

		const content = `${userMention(request.requested_by)}, your ban request against ${userMentionWithId(
			request.target_id
		)} has been ${formattedAction}${formattedReason ? ` - ${formattedReason}` : "."}`;

		config.log(LoggingEvent.BanRequestResult, {
			content,
			allowedMentions: { users: [request.requested_by] }
		});
	}

	/**
	 * Logs the action taken on a ban request.
	 *
	 * @param interaction The interaction that triggered the action.
	 * @param action The action taken.
	 * @param config The guild configuration.
	 * @param reason The reason provided for the action.
	 */

	private static async _log(
		interaction: ButtonInteraction<"cached"> | ModalSubmitInteraction<"cached">,
		action: BanRequestAction,
		config: GuildConfig,
		reason: string | null = null
	): Promise<void> {
		if (!config.canLogEvent(LoggingEvent.BanRequestReviewed)) return;

		const color = REQUEST_ACTION_TO_COLOR[action];
		const pastTenseAction = REQUEST_ACTION_TO_PAST_TENSE[action];

		const currentEmbed = interaction.message?.embeds.at(0);
		if (!currentEmbed) return;

		const updatedEmbed = EmbedBuilder.from(currentEmbed)
			.setColor(color)
			.setAuthor({ name: `Ban Request ${pastTenseAction}` })
			.setFooter({
				text: `Reviewed by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		if (reason) {
			updatedEmbed.addFields({ name: "Reviewer Reason", value: reason });
		}

		config.log(LoggingEvent.BanRequestReviewed, {
			embeds: [updatedEmbed]
		});
	}
}

export enum BanRequestAction {
	Accept = "accept",
	Deny = "deny",
	Disregard = "disregard"
}

export const REQUEST_ACTION_TO_PAST_TENSE: Record<BanRequestAction, string> = {
	[BanRequestAction.Accept]: "Accepted",
	[BanRequestAction.Deny]: "Denied",
	[BanRequestAction.Disregard]: "Disregarded"
};

export const REQUEST_ACTION_TO_COLOR: Record<BanRequestAction, ColorResolvable> = {
	[BanRequestAction.Accept]: Colors.Green,
	[BanRequestAction.Deny]: Colors.Red,
	[BanRequestAction.Disregard]: Colors.Blurple
};
