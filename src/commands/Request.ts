import {
	ApplicationCommandData,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	ChatInputCommandInteraction,
	InteractionContextType,
	MessageFlags
} from "discord.js";

import ms, { type StringValue } from "ms";

import { prisma } from "#root/index.js";
import { Command } from "#classes/Command.js";
import { parseDurationString, validateDuration } from "#utils/index.js";

import type { InteractionReplyData } from "#utils/Types.js";

import BanRequestUtils from "#utils/BanRequests.js";
import ModerationUtils from "#utils/Moderation.js";

export default class Request extends Command {
	public constructor() {
		super({
			name: "request",
			description: "Request a moderation action."
		});
	}

	public register(): ApplicationCommandData {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			contexts: [InteractionContextType.Guild],
			options: [
				{
					name: "ban",
					description: "Request a ban for a user.",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "target",
							description: "The user to request a ban for.",
							type: ApplicationCommandOptionType.User,
							required: true
						},
						{
							name: "duration",
							description: "The duration of the ban.",
							type: ApplicationCommandOptionType.String,
							required: false
						},
						{
							name: "reason",
							description: "The reason for the ban.",
							type: ApplicationCommandOptionType.String,
							required: false
						}
					]
				}
			]
		};
	}

	public async interactionRun(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const config = await prisma.banRequestConfig.findUnique({
			where: { id: interaction.guildId }
		});

		if (!config?.enabled || !config.webhook_url) {
			return { error: "Ban requests are not configured for this server." };
		}

		const target = interaction.options.getUser("target", true);

		if (!target) {
			return { error: "The target user could not be found." };
		}

		const existingRequest = await prisma.banRequest.findFirst({
			where: {
				guild_id: interaction.guildId,
				target_id: target.id,
				status: "Pending",
				requested_by: interaction.user.id
			}
		});

		if (existingRequest) {
			return { error: "You already have a pending ban request for this user." };
		}

		const existingBan = await interaction.guild.bans.fetch(target.id).catch(() => null);

		if (existingBan) {
			return { error: "The provided target is already banned." };
		}

		const targetMember = interaction.guild.members.cache.get(target.id);

		if (targetMember && config.immune_roles.some(role => targetMember.roles.cache.has(role))) {
			return { error: "The provided target is immune to ban requests." };
		}

		const rawDuration = interaction.options.getString("duration", false);

		if (rawDuration && ms(rawDuration as StringValue) === undefined) {
			return {
				error: "The provided duration is invalid. Please provide a valid duration string (e.g., 1d, 12h, 30m)."
			};
		}

		const duration = parseDurationString(rawDuration);

		if (duration) {
			const durationValidation = validateDuration({ duration, minimum: "1s", maximum: "5y" });
			if (!durationValidation.ok) {
				return { error: durationValidation.message };
			}
		}

		const actionValidation = ModerationUtils.validateAction({
			target,
			executor: interaction.member,
			action: "Ban"
		});

		if (!actionValidation.ok) {
			return { error: actionValidation.message };
		}

		const reason = interaction.options.getString("reason", false);

		if (!reason && config.enforce_submission_reason) {
			return { error: "A reason is required to submit a ban request in this server." };
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		return BanRequestUtils.create({
			config,
			target,
			duration,
			reason: reason ?? "No reason provided.",
			executor: interaction.member
		});
	}
}
