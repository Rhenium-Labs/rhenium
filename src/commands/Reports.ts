import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType,
	PermissionFlagsBits
} from "discord.js";

import { kysely } from "#root/index.js";
import { ApplyOptions, Command } from "#rhenium";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#root/lib/config/GuildConfig.js";

@ApplyOptions<Command.Options>({
	name: "reports",
	description: "Manage the report system."
})
export default class Reports extends Command {
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

	public async interactionRun(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const subcommand = interaction.options.getSubcommand(true);
		const config = configClass.getMessageReportsConfig();

		if (!config) {
			return { error: "Message reports have not been configured on this server." };
		}

		switch (subcommand) {
			case "blacklist": {
				const user = interaction.options.getUser("user", true);

				if (config.blacklisted_users.includes(user.id)) {
					return { error: "This user is already blacklisted from using the report system." };
				}

				await kysely
					.updateTable("MessageReportConfig")
					.set({ blacklisted_users: [...config.blacklisted_users, user.id] })
					.where("id", "=", interaction.guild.id)
					.execute();

				return {
					content: `Successfully blacklisted ${user.tag} from using the report system.`
				};
			}

			case "unblacklist": {
				const user = interaction.options.getUser("user", true);

				if (!config.blacklisted_users.includes(user.id)) {
					return { error: "This user is not blacklisted from using the report system." };
				}

				await kysely
					.updateTable("MessageReportConfig")
					.set({
						blacklisted_users: config.blacklisted_users.filter(id => id !== user.id)
					})
					.where("id", "=", interaction.guild.id)
					.execute();

				return {
					content: `Successfully unblacklisted ${user.tag} from using the report system.`
				};
			}

			default:
				return { error: "Unknown subcommand." };
		}
	}
}
