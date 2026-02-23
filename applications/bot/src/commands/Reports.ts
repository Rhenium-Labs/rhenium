import {
	type ApplicationCommandData,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits
} from "discord.js";

import { kysely } from "@root/index";
import { RawGuildConfig } from "@config/Schema";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "@commands/Command";
import MessageReportUtils from "@utils/MessageReports";

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
					name: ReportSubcommand.Blacklist,
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
					name: ReportSubcommand.Unblacklist,
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
				},
				{
					name: ReportSubcommand.Search,
					description: "Search for pending reports.",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "user",
							description: "Filter reports by a specific user.",
							type: ApplicationCommandOptionType.User,
							required: false
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

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!reportsConfig)
			return { error: "Message reports have not been configured on this server." };

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

				const updatedConfig: RawGuildConfig = {
					...config.data,
					message_reports: {
						...config.data.message_reports,
						blacklisted_users: [...reportsConfig.blacklisted_users, user.id]
					}
				};

				await kysely
					.updateTable("Guild")
					.set({ config: updatedConfig })
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

				const updatedConfig: RawGuildConfig = {
					...config.data,
					message_reports: {
						...config.data.message_reports,
						blacklisted_users: reportsConfig.blacklisted_users.filter(
							id => id !== user.id
						)
					}
				};

				await kysely
					.updateTable("Guild")
					.set({ config: updatedConfig })
					.where("id", "=", interaction.guild.id)
					.execute();

				return {
					content: `Successfully unblacklisted ${user.tag} from using the report system.`
				};
			}

			case ReportSubcommand.Search: {
				const target = interaction.options.getUser("user", false);

				const result = await MessageReportUtils.search({
					config,
					executor: interaction.member,
					target,
					page: 1
				});

				if (!result.ok) return { error: result.message };
				return result.data;
			}
		}
	}
}

enum ReportSubcommand {
	Blacklist = "blacklist",
	Unblacklist = "unblacklist",
	Search = "search"
}
