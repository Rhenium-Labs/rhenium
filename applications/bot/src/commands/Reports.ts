import {
	type ApplicationCommandData,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	EmbedBuilder,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	userMention
} from "discord.js";

import { kysely } from "@root/index";
import { ReportStatus } from "@repo/db";
import { RawGuildConfig } from "@repo/config";

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
				},
				{
					name: ReportSubcommand.Leaderboard,
					description: "View report system leaderboard.",
					type: ApplicationCommandOptionType.Subcommand,
					options: [
						{
							name: "sort",
							description: "Sorting method for the stats.",
							type: ApplicationCommandOptionType.String,
							required: true,
							choices: [
								{
									name: "Most Accurate Reporter",
									value: ReportSortMethod.Accuracy
								},
								{
									name: "Most Active Reporter",
									value: ReportSortMethod.Activity
								},
								{
									name: "Most Reported Users",
									value: ReportSortMethod.Reported
								}
							]
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

			case ReportSubcommand.Leaderboard: {
				const sortMethod = interaction.options.getString(
					"sort",
					true
				) as ReportSortMethod;

				const groupByColumn =
					sortMethod === ReportSortMethod.Reported ? "author_id" : "reported_by";

				let query = kysely
					.selectFrom("MessageReport")
					.select(eb => [groupByColumn, eb.fn.countAll<number>().as("count")])
					.where("guild_id", "=", interaction.guild.id)
					.groupBy(groupByColumn)
					.orderBy("count", "desc")
					.limit(5);

				if (sortMethod === ReportSortMethod.Accuracy) {
					query = query.where("status", "=", ReportStatus.Resolved);
				}

				const titleMap: Record<ReportSortMethod, string> = {
					[ReportSortMethod.Accuracy]: "Most Accurate Reporters",
					[ReportSortMethod.Activity]: "Most Active Reporters",
					[ReportSortMethod.Reported]: "Most Reported Users"
				};
				const results = await query.execute();

				if (results.length === 0)
					return {
						error: `There is no sufficient data to display the ${titleMap[sortMethod].toLowerCase()}.`
					};

				const description = results
					.map((row, i) => {
						const userId = row[groupByColumn] as string;
						return `${i + 1}. ${userMention(userId)} (\`${userId}\`) — **${Number(row.count)}** ${Number(row.count) === 1 ? "report" : "reports"}`;
					})
					.join("\n");

				const embed = new EmbedBuilder()
					.setColor("NotQuiteBlack")
					.setAuthor({
						name: `${interaction.guild.name} - ${titleMap[sortMethod]}`,
						iconURL: interaction.guild.iconURL() ?? undefined
					})
					.setDescription(description)
					.setTimestamp();

				return { embeds: [embed] };
			}
		}
	}
}

enum ReportSubcommand {
	Blacklist = "blacklist",
	Unblacklist = "unblacklist",
	Search = "search",
	Leaderboard = "leaderboard"
}

enum ReportSortMethod {
	Accuracy = "accuracy",
	Activity = "activity",
	Reported = "reported"
}
