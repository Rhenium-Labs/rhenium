import {
	type ApplicationCommandData,
	type ChatInputCommandInteraction,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType
} from "discord.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Command from "#classes/Command.js";

export default class Reports extends Command {
	public constructor() {
		super({
			name: "reports",
			description: "Manage the report system."
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
					name: "blacklist",
					description: "Blacklist a user from using the report system.",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "user",
							description: "The user to blacklist.",
							type: ApplicationCommandOptionType.User,
							required: true
						}
					]
				},
				{
					name: "unblacklist",
					description: "Unblacklist a user from using the report system.",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "user",
							description: "The user to unblacklist.",
							type: ApplicationCommandOptionType.User,
							required: true
						}
					]
				}
			]
		};
	}

	public async interactionRun(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const subcommand = interaction.options.getSubcommand(true);

		switch (subcommand) {
			case "blacklist": {
				const user = interaction.options.getUser("user", true);
				const config = await this.prisma.messageReportConfig.findUnique({
					where: { id: interaction.guild.id }
				});

				if (!config?.enabled || !config.webhook_url) {
					return { error: "Message reports have not been configured on this server." };
				}

				if (config.blacklisted_users.includes(user.id)) {
					return { error: "This user is already blacklisted from using the report system." };
				}

				await this.prisma.messageReportConfig.update({
					where: { id: interaction.guild.id },
					data: {
						blacklisted_users: { push: user.id }
					}
				});

				return {
					content: `Successfully blacklisted ${user.tag} from using the report system.`
				};
			}

			case "unblacklist": {
				const user = interaction.options.getUser("user", true);
				const config = await this.prisma.messageReportConfig.findUnique({
					where: { id: interaction.guild.id }
				});

				if (!config?.enabled || !config.webhook_url) {
					return { error: "Message reports have not been configured on this server." };
				}

				if (!config.blacklisted_users.includes(user.id)) {
					return { error: "This user is not blacklisted from using the report system." };
				}

				await this.prisma.messageReportConfig.update({
					where: { id: interaction.guild.id },
					data: {
						blacklisted_users: config.blacklisted_users.filter(id => id !== user.id)
					}
				});

				return {
					content: `Successfully unblacklisted ${user.tag} from using the report system.`
				};
			}

			default:
				return { error: "Unknown subcommand." };
		}
	}
}
