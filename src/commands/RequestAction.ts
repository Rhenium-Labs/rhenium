import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits
} from "discord.js";

import { ApplyOptions, Command } from "#rhenium";

import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#config/GuildConfig.js";
import BanRequestUtils from "#utils/BanRequests.js";

@ApplyOptions<Command.Options>({
	name: "request",
	description: "Request a moderation action."
})
export default class RequestAction extends Command {
	public register(): Command.Data {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			contexts: [InteractionContextType.Guild],
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
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
							required: false,
							max_length: 1024,
							min_length: 1
						}
					]
				}
			]
		};
	}

	public async interactionRun(
		interaction: Command.Interaction<"chatInput">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		if (!config.getBanRequestsConfig())
			return {
				error: "Ban requests have not been configured on this server."
			};

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const target = interaction.options.getUser("target", true);
		const durationStr = interaction.options.getString("duration");
		const reason = interaction.options.getString("reason");

		if (!target) {
			return { error: "The target user could not be found." };
		}

		if (await interaction.guild.bans.fetch(target.id).catch(() => null)) {
			return { error: "The provided target is already banned." };
		}

		const result = await BanRequestUtils.create({
			config,
			target,
			reason,
			executor: interaction.member,
			durationStr
		});

		if (!result.ok) {
			return { error: result.message };
		}

		return {
			content: `Successfully submitted a ban request for ${target} - ID \`${result.data.id}\`.`
		};
	}
}
