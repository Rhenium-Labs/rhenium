import {
	type ApplicationCommandData,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType,
	PermissionFlagsBits
} from "discord.js";

import { kysely } from "#root/index.js";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "#managers/commands/Command.js";

export default class Reports extends Command {
	constructor() {
		super({
			name: "reports",
			category: CommandCategory.Moderation,
			description: "Manage the report system."
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

	override async executeInteraction({
		interaction,
		config
	}: CommandExecutionContext<"chatInputCmd">): Promise<ResponseData<"interaction">> {
		const subcommand = interaction.options.getSubcommand(true) as ReportSubcommand;
		const reportsConfig = config.parseReportsConfig();

		if (!reportsConfig) {
			return { error: "Message reports have not been configured on this server." };
		}

		switch (subcommand) {
			case ReportSubcommand.Blacklist: {
				const user = interaction.options.getUser("user", true);

				if (user.id === interaction.user.id) {
					return {
						error: "You cannot blacklist yourself from using the report system."
					};
				}

				if (reportsConfig.blacklisted_users.includes(user.id)) {
					return {
						error: "This user is already blacklisted from using the report system."
					};
				}

				await kysely
					.updateTable("MessageReportConfig")
					.set({ blacklisted_users: [...reportsConfig.blacklisted_users, user.id] })
					.where("id", "=", interaction.guild.id)
					.execute();

				return {
					content: `Successfully blacklisted ${user.tag} from using the report system.`
				};
			}

			case ReportSubcommand.Unblacklist: {
				const user = interaction.options.getUser("user", true);

				if (!reportsConfig.blacklisted_users.includes(user.id)) {
					return {
						error: "This user is not blacklisted from using the report system."
					};
				}

				await kysely
					.updateTable("MessageReportConfig")
					.set({
						blacklisted_users: reportsConfig.blacklisted_users.filter(
							id => id !== user.id
						)
					})
					.where("id", "=", interaction.guild.id)
					.execute();

				return {
					content: `Successfully unblacklisted ${user.tag} from using the report system.`
				};
			}
		}
	}
}

enum ReportSubcommand {
	Blacklist = "blacklist",
	Unblacklist = "unblacklist"
}
