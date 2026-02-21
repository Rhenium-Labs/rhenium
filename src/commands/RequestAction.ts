import {
	type ApplicationCommandData,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits
} from "discord.js";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "@commands/Command";

import BanRequestUtils from "@utils/BanRequests";

export default class RequestAction extends Command {
	constructor() {
		super({
			name: "request",
			category: CommandCategory.Moderation,
			description: "Request a moderation action."
		});
	}

	override register(): ApplicationCommandData {
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

	override async executeInteraction({
		interaction,
		config
	}: CommandExecutionContext<"chatInputCmd">): Promise<ResponseData<"interaction">> {
		if (!config.parseBanRequestsConfig())
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
