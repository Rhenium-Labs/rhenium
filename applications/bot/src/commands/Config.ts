import {
	type ChatInputCommandInteraction,
	type ApplicationCommandData,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	ChannelType,
	Colors,
	EmbedBuilder,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	roleMention
} from "discord.js";

import ms from "ms";

import { Detector } from "@repo/db";
import { kysely, client } from "#root/index.js";
import { ContentFilterVerbosity, DetectorMode, UserPermission } from "@repo/config";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "#commands/Command.js";
import GuildConfig from "#config/GuildConfig.js";

export default class Config extends Command {
	constructor() {
		super({
			name: "config",
			category: CommandCategory.Management,
			description: "Manage the guild's configuration."
		});
	}

	override register(): ApplicationCommandData {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			contexts: [InteractionContextType.Guild],
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
			options: [
				{
					name: ConfigSubcommandGroup.Permissions,
					description: "Permission scopes.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Create,
							description: "Create a new permission scope.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role associated with the scope.",
									type: ApplicationCommandOptionType.Role,
									required: true
								},
								{
									name: "permission",
									description: "Base permission to assign.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(UserPermission).map(
										permission => ({
											name: permission,
											value: permission
										})
									)
								}
							]
						},
						{
							name: ConfigSubcommand.Delete,
							description: "Delete a permission scope.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role associated with the scope.",
									type: ApplicationCommandOptionType.Role,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.List,
							description: "List all permission scopes.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.Grant,
							description: "Add a permission to a scope.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role associated with the scope.",
									type: ApplicationCommandOptionType.Role,
									required: true
								},
								{
									name: "permission",
									description: "The permission.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(UserPermission).map(
										permission => ({
											name: permission,
											value: permission
										})
									)
								}
							]
						},
						{
							name: ConfigSubcommand.Revoke,
							description: "Remove a permission from a scope.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role associated with the scope.",
									type: ApplicationCommandOptionType.Role,
									required: true
								},
								{
									name: "permission",
									description: "The permission.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(UserPermission).map(
										permission => ({
											name: permission,
											value: permission
										})
									)
								}
							]
						}
					]
				},
				{
					name: ConfigSubcommandGroup.Reports,
					description: "Message report settings.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Toggle,
							description: "Enable or disable message reports.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetDefaultReason,
							description: "Set a default reason for reports.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "reason",
									description: "Reason to set. Use 'none' to clear.",
									type: ApplicationCommandOptionType.String,
									required: true,
									max_length: 1024,
									min_length: 1
								}
							]
						},
						{
							name: ConfigSubcommand.EnforceReason,
							description:
								"Enforce reporters to provide a reason when reporting messages.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enforce, false to not enforce.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.AddImmuneRole,
							description: "Make a role immune to reports.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.Role,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveImmuneRole,
							description: "Remove a role from report immunity.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.Role,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListImmuneRoles,
							description: "List all report immune roles.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.AddNotifyRole,
							description: "Add a role to be notified for new reports.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.String,
									required: true,
									autocomplete: true
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveNotifyRole,
							description: "Remove a role from report notifications.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.String,
									required: true,
									autocomplete: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListNotifyRoles,
							description: "List all roles notified on reports.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.SetReviewChannel,
							description: "Set the review channel for new reports.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.DeleteOnHandle,
							description:
								"Toggle deletion of the report submission after handling.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to delete, false to keep.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						}
					]
				},
				{
					name: ConfigSubcommandGroup.Requests,
					description: "Ban request settings.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Toggle,
							description: "Enable or disable ban requests.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetMessageDeleteLimit,
							description:
								"Delete messages sent by the target upon request approval.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "duration",
									description:
										"The amount of time to delete messages for.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: [
										{ name: "Disable", value: "0" },
										{ name: "Previous hour", value: "1h" },
										{ name: "Previous 6 hours", value: "6h" },
										{ name: "Previous 12 hours", value: "12h" },
										{ name: "Previous 24 hours", value: "24h" },
										{ name: "Previous 3 days", value: "3d" },
										{ name: "Previous 7 days", value: "7d" }
									]
								}
							]
						},
						{
							name: ConfigSubcommand.ToggleNotifDM,
							description:
								"Toggle whether to DM the target if the request is approved.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetAdditionalInfo,
							description:
								"Set additional info to include in ban request notifications.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "info",
									description:
										"The additional info. Use 'none' to clear.",
									type: ApplicationCommandOptionType.String,
									required: true,
									max_length: 1024,
									min_length: 1
								}
							]
						},
						{
							name: ConfigSubcommand.DisableReasonField,
							description: `Disable the reason field in the ban request notification DM embed.`,
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description:
										"True to hide the reason field, false to show it.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetReviewChannel,
							description: "Set the review channel for ban requests.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListNotifyRoles,
							description:
								"List all roles notified on ban request submission.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.AddNotifyRole,
							description:
								"Add a role to be notified on ban request submission.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.String,
									required: true,
									autocomplete: true
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveNotifyRole,
							description:
								"Remove a role from ban request creation notifications.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.String,
									required: true,
									autocomplete: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListImmuneRoles,
							description: "List all ban request immune roles.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.AddImmuneRole,
							description: "Make a role immune to ban requests.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.Role,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveImmuneRole,
							description: "Remove a role from ban request immunity.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.Role,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.AutomaticallyTimeout,
							description: "Toggle automatic timeouts for request targets.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						}
					]
				},
				{
					name: ConfigSubcommandGroup.Highlights,
					description: "Highlight settings.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Toggle,
							description: "Toggle message highlights.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetMaxPatterns,
							description:
								"Set the maximum number of highlight patterns per user.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "amount",
									description: "The maximum number of patterns.",
									type: ApplicationCommandOptionType.Integer,
									required: true,
									min_value: 1,
									max_value: 30
								}
							]
						}
					]
				},
				{
					name: ConfigSubcommandGroup.QuickPurges,
					description: "Quick purge settings.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Toggle,
							description: "Toggle quick purges.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetLimit,
							description:
								"Set the maximum number of messages that can be purged at once.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "amount",
									description: "The limit.",
									type: ApplicationCommandOptionType.Integer,
									required: true,
									min_value: 2,
									max_value: 500
								}
							]
						},
						{
							name: ConfigSubcommand.AddChannelScoping,
							description: "Add a channel to quick purge channel scopes.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								},
								{
									name: "type",
									description:
										"Include or exclude quick purges in this channel.",
									type: ApplicationCommandOptionType.Number,
									required: true,
									choices: [
										{ name: "Include", value: 0 },
										{ name: "Exclude", value: 1 }
									]
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveChannelScoping,
							description: "Remove a channel from quick purge channel scopes.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListChannelScopings,
							description: "List all quick purge channel scopes.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: ConfigSubcommandGroup.QuickMutes,
					description: "Quick mute settings.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Toggle,
							description: "Toggle quick mutes.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetPurgeLimit,
							description:
								"Set the maximum number of messages that can be purged at once.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "amount",
									description: "The limit.",
									type: ApplicationCommandOptionType.Integer,
									required: true,
									min_value: 2,
									max_value: 500
								}
							]
						},
						{
							name: ConfigSubcommand.AddChannelScoping,
							description: "Add a channel to quick mute channel scopes.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								},
								{
									name: "type",
									description:
										"Include or exclude quick mutes in this channel.",
									type: ApplicationCommandOptionType.Number,
									required: true,
									choices: [
										{ name: "Include", value: 0 },
										{ name: "Exclude", value: 1 }
									]
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveChannelScoping,
							description: "Remove a channel from quick mute channel scopes.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListChannelScopings,
							description: "List all quick mute channel scopes.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: ConfigSubcommandGroup.ContentFilter,
					description: "Content filter settings.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Toggle,
							description: "Toggle the content filter.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetReviewChannel,
							description:
								"Set the channel where new content filter alerts are sent.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									channel_types: [ChannelType.GuildText],
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.AddImmuneRole,
							description: "Make a role immune to the content filter.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.Role,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveImmuneRole,
							description: "Remove a role from content filter immunity.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role.",
									type: ApplicationCommandOptionType.Role,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListImmuneRoles,
							description: "List all content filter immune roles.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.AddChannelScoping,
							description: "Add a channel to content filter channel scopes.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								},
								{
									name: "type",
									description:
										"Include or exclude the content filter in this channel.",
									type: ApplicationCommandOptionType.Number,
									required: true,
									choices: [
										{ name: "Include", value: 0 },
										{ name: "Exclude", value: 1 }
									]
								}
							]
						},
						{
							name: ConfigSubcommand.RemoveChannelScoping,
							description:
								"Remove a channel from content filter channel scopes.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.ListChannelScopings,
							description: "List all content filter channel scopes.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.ToggleDetector,
							description: "Toggle a specific content filter detector.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "detector",
									description: "The detector.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(Detector).map(detector => ({
										name: detector,
										value: detector
									}))
								},
								{
									name: "value",
									description: "True to enable, false to disable.",
									type: ApplicationCommandOptionType.Boolean,
									required: true
								}
							]
						},
						{
							name: ConfigSubcommand.SetDetectorMode,
							description: "Set the mode for content filter detectors.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "mode",
									description: "The mode.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(DetectorMode).map(mode => ({
										name: mode,
										value: mode
									}))
								}
							]
						},
						{
							name: ConfigSubcommand.SetVerbosity,
							description:
								"Set the verbosity level for content filter alerts.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "level",
									description: "The verbosity level.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(ContentFilterVerbosity).map(
										level => ({
											name: level,
											value: level
										})
									)
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
		const subcommandGroup = interaction.options.getSubcommandGroup() as ConfigSubcommandGroup;
		const subcommand = interaction.options.getSubcommand() as ConfigSubcommand;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		switch (subcommandGroup) {
			case ConfigSubcommandGroup.Permissions:
				switch (subcommand) {
					case ConfigSubcommand.Create:
						return Config._createPermissionScope(interaction, config);
					case ConfigSubcommand.Delete:
						return Config._deletePermissionScope(interaction, config);
					case ConfigSubcommand.List:
						return Config._listPermissionScopes(interaction, config);
					case ConfigSubcommand.Grant:
						return Config._addPermissionToScope(interaction, config);
					case ConfigSubcommand.Revoke:
						return Config._removePermissionFromScope(interaction, config);
				}
				break;

			case ConfigSubcommandGroup.Reports:
				switch (subcommand) {
					case ConfigSubcommand.Toggle:
						return Config._toggleReports(interaction, config);
					case ConfigSubcommand.DeleteOnHandle:
						return Config._toggleReportsDeleteOnHandle(interaction, config);
					case ConfigSubcommand.SetDefaultReason:
						return Config._setReportsDefaultReason(interaction, config);
					case ConfigSubcommand.EnforceReason:
						return Config._toggleReportsEnforceReason(interaction, config);
					case ConfigSubcommand.AddImmuneRole:
						return Config._addReportsImmuneRole(interaction, config);
					case ConfigSubcommand.RemoveImmuneRole:
						return Config._removeReportsImmuneRole(interaction, config);
					case ConfigSubcommand.ListImmuneRoles:
						return Config._listReportImmuneRoles(interaction, config);
					case ConfigSubcommand.AddNotifyRole:
						return Config._addReportNotifyRole(interaction, config);
					case ConfigSubcommand.RemoveNotifyRole:
						return Config._removeReportNotifyRole(interaction, config);
					case ConfigSubcommand.ListNotifyRoles:
						return Config._listReportNotifyRoles(interaction, config);
					case ConfigSubcommand.SetReviewChannel:
						return Config._setReportReviewChannel(interaction, config);
				}
				break;

			case ConfigSubcommandGroup.Requests:
				switch (subcommand) {
					case ConfigSubcommand.Toggle:
						return Config._toggleRequests(interaction, config);
					case ConfigSubcommand.ToggleNotifDM:
						return Config._toggleRequestNotifDM(interaction, config);
					case ConfigSubcommand.DisableReasonField:
						return Config._disableRequestReasonField(interaction, config);
					case ConfigSubcommand.SetAdditionalInfo:
						return Config._setRequestAdditionalInfo(interaction, config);
					case ConfigSubcommand.SetMessageDeleteLimit:
						return Config._setRequestMessageDeleteLimit(interaction, config);
					case ConfigSubcommand.SetReviewChannel:
						return Config._setRequestReviewChannel(interaction, config);
					case ConfigSubcommand.AutomaticallyTimeout:
						return Config._toggleAutomaticallyTimeout(interaction, config);
					case ConfigSubcommand.AddImmuneRole:
						return Config._addRequestImmuneRole(interaction, config);
					case ConfigSubcommand.RemoveImmuneRole:
						return Config._removeRequestImmuneRole(interaction, config);
					case ConfigSubcommand.ListImmuneRoles:
						return Config._listRequestImmuneRoles(interaction, config);
					case ConfigSubcommand.AddNotifyRole:
						return Config._addRequestNotifyRole(interaction, config);
					case ConfigSubcommand.RemoveNotifyRole:
						return Config._removeRequestNotifyRole(interaction, config);
					case ConfigSubcommand.ListNotifyRoles:
						return Config._listRequestNotifyRoles(interaction, config);
				}
				break;

			case ConfigSubcommandGroup.Highlights:
				switch (subcommand) {
					case ConfigSubcommand.Toggle:
						return Config._toggleHighlights(interaction, config);
					case ConfigSubcommand.SetMaxPatterns:
						return Config._setMaxHighlightPatterns(interaction, config);
				}
				break;

			case ConfigSubcommandGroup.QuickPurges:
				switch (subcommand) {
					case ConfigSubcommand.Toggle:
						return Config._toggleQuickPurges(interaction, config);
					case ConfigSubcommand.SetLimit:
						return Config._setQuickPurgeLimit(interaction, config);
					case ConfigSubcommand.AddChannelScoping:
						return Config._addQuickPurgeChannelScoping(interaction, config);
					case ConfigSubcommand.RemoveChannelScoping:
						return Config._removeQuickPurgeChannelScoping(interaction, config);
					case ConfigSubcommand.ListChannelScopings:
						return Config._listQuickPurgeChannelScopings(interaction, config);
				}
				break;

			case ConfigSubcommandGroup.QuickMutes:
				switch (subcommand) {
					case ConfigSubcommand.Toggle:
						return Config._toggleQuickMutes(interaction, config);
					case ConfigSubcommand.SetPurgeLimit:
						return Config._setQuickMutePurgeLimit(interaction, config);
					case ConfigSubcommand.AddChannelScoping:
						return Config._addQuickMuteChannelScoping(interaction, config);
					case ConfigSubcommand.RemoveChannelScoping:
						return Config._removeQuickMuteChannelScoping(interaction, config);
					case ConfigSubcommand.ListChannelScopings:
						return Config._listQuickMuteChannelScopings(interaction, config);
				}
				break;

			case ConfigSubcommandGroup.ContentFilter:
				switch (subcommand) {
					case ConfigSubcommand.Toggle:
						return Config._toggleContentFilter(interaction, config);
					case ConfigSubcommand.SetReviewChannel:
						return Config._setContentFilterReviewChannel(interaction, config);
					case ConfigSubcommand.AddImmuneRole:
						return Config._addContentFilterImmuneRole(interaction, config);
					case ConfigSubcommand.RemoveImmuneRole:
						return Config._removeContentFilterImmuneRole(interaction, config);
					case ConfigSubcommand.ListImmuneRoles:
						return Config._listContentFilterImmuneRoles(interaction, config);
					case ConfigSubcommand.AddChannelScoping:
						return Config._addContentFilterChannelScoping(interaction, config);
					case ConfigSubcommand.RemoveChannelScoping:
						return Config._removeContentFilterChannelScoping(interaction, config);
					case ConfigSubcommand.ListChannelScopings:
						return Config._listContentFilterChannelScopings(interaction, config);
					case ConfigSubcommand.ToggleDetector:
						return Config._toggleContentFilterDetector(interaction, config);
					case ConfigSubcommand.SetDetectorMode:
						return Config._setContentFilterDetectorMode(interaction, config);
					case ConfigSubcommand.SetVerbosity:
						return Config._setContentFilterVerbosity(interaction, config);
				}
				break;
		}

		return { error: "Unknown subcommand." };
	}

	private static async _setContentFilterDetectorMode(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const mode = interaction.options.getString("mode", true) as DetectorMode;
		const currentMode = config.data.content_filter.detector_mode;

		if (mode === currentMode)
			return { error: `Content filter detector mode is already set to ${mode}.` };

		const updatedConfig = {
			...config.data,
			content_filter: {
				...config.data.content_filter,
				detector_mode: mode
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully set content filter detector mode to ${mode}.` };
	}

	private static async _setContentFilterVerbosity(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const level = interaction.options.getString("level", true) as ContentFilterVerbosity;
		const currentLevel = config.data.content_filter.verbosity;

		if (level === currentLevel)
			return { error: `Content filter verbosity is already set to ${level}.` };

		const updatedConfig = {
			...config.data,
			content_filter: {
				...config.data.content_filter,
				verbosity: level
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully set content filter verbosity to ${level}.` };
	}

	private static async _toggleContentFilterDetector(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const detector = interaction.options.getString("detector", true) as Detector;
		const enable = interaction.options.getBoolean("value", true);
		const currentDetectors = config.data.content_filter.detectors;

		if (enable && currentDetectors.includes(detector))
			return { error: `The ${detector} detector is already enabled.` };

		if (!enable && !currentDetectors.includes(detector))
			return { error: `The ${detector} detector is already disabled.` };

		const updatedDetectors = enable
			? [...currentDetectors, detector]
			: currentDetectors.filter(d => d !== detector);

		const updatedConfig = {
			...config.data,
			content_filter: {
				...config.data.content_filter,
				detectors: updatedDetectors
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} the ${detector} detector.`
		};
	}

	private static async _toggleContentFilter(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.content_filter.enabled;

		if (enable === current) {
			return {
				error: `Content filter is already ${enable ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			content_filter: {
				...configClass.data.content_filter,
				enabled: enable
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} the content filter.`
		};
	}

	private static async _setContentFilterReviewChannel(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.content_filter;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The content filter review channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: client.user.displayAvatarURL(),
					name: client.user.username
				})
				.catch(() => null);

			if (!set) {
				return {
					error: "Failed to move the existing webhook to the specified channel."
				};
			}

			const updatedConfig = {
				...configClass.data,
				content_filter: {
					...configClass.data.content_filter,
					webhook_channel: channel.id
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully moved the content filter review channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: client.user.username,
					avatar: client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			const updatedConfig = {
				...configClass.data,
				content_filter: {
					...configClass.data.content_filter,
					webhook_url: newWebhook.url,
					webhook_channel: channel.id
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully set the content filter review channel to ${channel}.`
			};
		}
	}

	private static async _addContentFilterImmuneRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.content_filter;

		if (config.immune_roles.includes(role.id)) {
			return { error: `${role} is already immune to the content filter.` };
		}

		const updatedRoles = [...config.immune_roles, role.id];

		const updatedConfig = {
			...configClass.data,
			content_filter: {
				...configClass.data.content_filter,
				immune_roles: updatedRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully added ${role} to content filter immune roles.` };
	}

	private static async _removeContentFilterImmuneRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.content_filter;

		if (!config.immune_roles.includes(role.id)) {
			return { error: `${role} is not immune to the content filter.` };
		}

		const updatedRoles = config.immune_roles.filter(r => r !== role.id);

		const updatedConfig = {
			...configClass.data,
			content_filter: {
				...configClass.data.content_filter,
				immune_roles: updatedRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully removed ${role} from content filter immune roles.` };
	}

	private static async _listContentFilterImmuneRoles(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.content_filter;

		if (!config.immune_roles.length) {
			return { content: "There are no immune roles configured for content filter." };
		}

		const roleMentions = config.immune_roles.map(id => `<@&${id}>`).join("\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Content Filter Immune Roles in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(roleMentions)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _addContentFilterChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.content_filter;
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getNumber("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		if (config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is already scoped` };
		}

		const updatedConfig = {
			...configClass.data,
			content_filter: {
				...configClass.data.content_filter,
				channel_scoping: [
					...config.channel_scoping,
					{ channel_id: channel.id, type: scopeType }
				]
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully added the channel ${channel} to content filter channel scoping as an \`${stringifiedType}\` channel.`
		};
	}

	private static async _removeContentFilterChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.content_filter;
		const channel = interaction.options.getChannel("channel", true);

		if (!config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is not scoped.` };
		}

		const updatedConfig = {
			...configClass.data,
			content_filter: {
				...configClass.data.content_filter,
				channel_scoping: config.channel_scoping.filter(s => s.channel_id !== channel.id)
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully removed the channel ${channel} from content filter channel scoping.`
		};
	}

	private static async _listContentFilterChannelScopings(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.content_filter;
		const scopings = config.channel_scoping;

		if (scopings.length === 0) {
			return {
				content: "There are no content filter channel scopings configured for this guild."
			};
		}

		const description = scopings
			.map(scope => {
				const channelMentionStr = `<#${scope.channel_id}>`;
				const typeStr = scope.type === 0 ? "Include" : "Exclude";

				return `${channelMentionStr}\n└ Type: \`${typeStr}\``;
			})
			.join("\n\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Content Filter Channel Scopings in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(description)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _toggleQuickMutes(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.quick_mutes.enabled;

		if (enable === current) {
			return {
				error: `Quick mutes are already ${enable ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			quick_mutes: {
				...configClass.data.quick_mutes,
				enabled: enable
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} quick mutes.`
		};
	}

	private static async _toggleQuickPurges(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.quick_purges.enabled;

		if (enable === current) {
			return {
				error: `Quick purges are already ${enable ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			quick_purges: {
				...configClass.data.quick_purges,
				enabled: enable
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} quick purges.`
		};
	}

	private static async _toggleHighlights(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.highlights.enabled;

		if (enable === current) {
			return {
				error: `Highlights are already ${enable ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			highlights: {
				...configClass.data.highlights,
				enabled: enable
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} highlights.`
		};
	}

	private static async _setQuickMutePurgeLimit(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const amount = interaction.options.getInteger("amount", true);
		const config = configClass.data.quick_mutes;

		if (config.purge_limit === amount) {
			return {
				error: `The quick mute purge limit is already set to ${amount}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			quick_mutes: {
				...configClass.data.quick_mutes,
				purge_limit: amount
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully set the quick mute purge limit to ${amount}.`
		};
	}

	private static async _addQuickMuteChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.quick_mutes;
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getNumber("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		if (config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is already scoped` };
		}

		const updatedConfig = {
			...configClass.data,
			quick_mutes: {
				...configClass.data.quick_mutes,
				channel_scoping: [
					...config.channel_scoping,
					{ channel_id: channel.id, type: scopeType }
				]
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully added the channel ${channel} to quick mute scoping as an \`${stringifiedType}\` channel.`
		};
	}

	private static async _removeQuickMuteChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.quick_mutes;
		const channel = interaction.options.getChannel("channel", true);

		const scope = config.channel_scoping.find(s => s.channel_id === channel.id);

		if (!scope) {
			return { error: `The channel ${channel} is not scoped.` };
		}

		const updatedConfig = {
			...configClass.data,
			quick_mutes: {
				...configClass.data.quick_mutes,
				channel_scoping: config.channel_scoping.filter(s => s.channel_id !== channel.id)
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully removed the channel ${channel} from quick mute scoping.`
		};
	}

	private static async _listQuickMuteChannelScopings(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.quick_mutes;
		const scopings = config.channel_scoping;

		if (scopings.length === 0) {
			return {
				content: "There are no quick mute channel scopings configured for this guild."
			};
		}

		const description = scopings
			.map(scope => {
				const channelMentionStr = `<#${scope.channel_id}>`;
				const typeStr = scope.type === 0 ? "Include" : "Exclude";

				return `${channelMentionStr}\n└ Type: \`${typeStr}\``;
			})
			.join("\n\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Quick Mute Channel Scopings in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(description)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return {
			embeds: [embed]
		};
	}

	private static async _setQuickPurgeLimit(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const amount = interaction.options.getInteger("amount", true);
		const config = configClass.data.quick_purges;

		if (config.max_limit === amount) {
			return {
				error: `The quick purge limit is already set to ${amount}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			quick_purges: {
				...configClass.data.quick_purges,
				max_limit: amount
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully set the quick purge limit to ${amount}.`
		};
	}

	private static async _addQuickPurgeChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.quick_purges;
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getNumber("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		if (config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is already scoped` };
		}

		const updatedConfig = {
			...configClass.data,
			quick_purges: {
				...configClass.data.quick_purges,
				channel_scoping: [
					...config.channel_scoping,
					{ channel_id: channel.id, type: scopeType }
				]
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully added the channel ${channel} to quick purge scoping as an \`${stringifiedType}\` channel.`
		};
	}

	private static async _removeQuickPurgeChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.quick_purges;
		const channel = interaction.options.getChannel("channel", true);

		const scope = config.channel_scoping.find(s => s.channel_id === channel.id);

		if (!scope) {
			return { error: `The channel ${channel} is not scoped.` };
		}

		const updatedConfig = {
			...configClass.data,
			quick_purges: {
				...configClass.data.quick_purges,
				channel_scoping: config.channel_scoping.filter(s => s.channel_id !== channel.id)
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guildId)
			.execute();

		return {
			content: `Successfully removed the channel ${channel} from quick purge scoping.`
		};
	}

	private static async _listQuickPurgeChannelScopings(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.quick_purges;
		const scopings = config.channel_scoping;

		if (scopings.length === 0) {
			return {
				content: "There are no quick purge channel scopings configured for this guild."
			};
		}

		const description = scopings
			.map(scope => {
				const channelMentionStr = `<#${scope.channel_id}>`;
				const typeStr = scope.type === 0 ? "Include" : "Exclude";

				return `${channelMentionStr}\n└ Type: \`${typeStr}\``;
			})
			.join("\n\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Quick Purge Channel Scopings in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(description)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return {
			embeds: [embed]
		};
	}

	private static async _setMaxHighlightPatterns(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const amount = interaction.options.getInteger("amount", true);
		const config = configClass.data.highlights;

		if (config.max_patterns === amount) {
			return {
				error: `The maximum number of highlight patterns is already set to ${amount}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			highlights: {
				...configClass.data.highlights,
				max_patterns: amount
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully set the maximum number of highlight patterns to ${amount}.`
		};
	}

	private static async _createPermissionScope(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const permission = interaction.options.getString("permission", true) as UserPermission;

		const scopes = configClass.data.permission_scopes;
		const exists = scopes.find(s => s.role_id === role.id);

		if (exists) {
			return { error: `A permission scope for the role ${role} already exists.` };
		}

		const updatedConfig = {
			...configClass.data,
			permission_scopes: [
				...scopes,
				{ role_id: role.id, allowed_permissions: [permission] }
			]
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully created a permission scope for the ${role} role.` };
	}

	private static async _deletePermissionScope(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);

		const scopes = configClass.data.permission_scopes;
		const scope = scopes.find(s => s.role_id === role.id);

		if (!scope) {
			return { error: `No permission scope found for the role ${role}.` };
		}

		const updatedConfig = {
			...configClass.data,
			permission_scopes: scopes.filter(s => s.role_id !== role.id)
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully deleted the permission scope for the ${role} role.` };
	}

	private static async _listPermissionScopes(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const scopes = config.data.permission_scopes;

		if (scopes.length === 0) {
			return { content: "There are no permission scopes configured for this guild." };
		}

		const description = scopes
			.map(scope => {
				const roleMentionStr = roleMention(scope.role_id);
				const permissionsStr = scope.allowed_permissions
					.map(p => `\`${p}\``)
					.join(", ");

				return `${roleMentionStr}\n└ ${permissionsStr}`;
			})
			.join("\n\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Permission Scopes in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(description)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return {
			embeds: [embed]
		};
	}

	private static async _addPermissionToScope(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const permission = interaction.options.getString("permission", true) as UserPermission;

		const scopes = configClass.data.permission_scopes;
		const scope = scopes.find(s => s.role_id === role.id);

		if (!scope) {
			return { error: `No permission scope found for the role ${role}.` };
		}

		if (scope.allowed_permissions.includes(permission)) {
			return {
				error: `The permission \`${permission}\` is already assigned to the scope for the role ${role}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			permission_scopes: scopes.map(s =>
				s.role_id === role.id
					? { ...s, allowed_permissions: [...s.allowed_permissions, permission] }
					: s
			)
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully added the permission \`${permission}\` to the scope for the role ${role}.`
		};
	}

	private static async _removePermissionFromScope(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const permission = interaction.options.getString("permission", true) as UserPermission;

		const scopes = configClass.data.permission_scopes;
		const scope = scopes.find(s => s.role_id === role.id);

		if (!scope) {
			return { error: `No permission scope found for the role ${role}.` };
		}

		if (!scope.allowed_permissions.includes(permission)) {
			return {
				error: `The permission \`${permission}\` is not assigned to the scope for the role ${role}.`
			};
		}

		if (scope.allowed_permissions.length === 1) {
			return {
				error: `Cannot remove the permission \`${permission}\` as it is the only permission assigned to the scope for the role ${role}. A scope must have at least one permission.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			permission_scopes: scopes.map(s =>
				s.role_id === role.id
					? {
							...s,
							allowed_permissions: s.allowed_permissions.filter(
								p => p !== permission
							)
						}
					: s
			)
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully removed the permission \`${permission}\` from the scope for the role ${role}.`
		};
	}

	private static async _toggleReports(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.message_reports;

		if (config.enabled === value) {
			return {
				error: `Message reports are already ${value ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				enabled: value
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} message reports.`
		};
	}

	private static async _toggleReportsDeleteOnHandle(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.message_reports;

		if (config.delete_submission_on_handle === value) {
			return {
				error: `Message report submission deletion on handle is already ${value ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				delete_submission_on_handle: value
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} message report submission deletion on handle.`
		};
	}

	private static async _setReportsDefaultReason(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const rawReason = interaction.options.getString("reason", true);
		const config = configClass.data.message_reports;

		if (config.placeholder_reason === rawReason) {
			return {
				error: `The default reason for message reports is already set to: ${rawReason}`
			};
		}

		const reason = rawReason.toLowerCase() === "none" ? null : rawReason;

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				placeholder_reason: reason
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${reason ? "set" : "cleared"} the default reason for message reports.`
		};
	}

	private static async _toggleReportsEnforceReason(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.message_reports;

		if (config.enforce_report_reason === value) {
			return {
				error: `Message report reason enforcement is already ${value ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				enforce_report_reason: value
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} message report reason enforcement.`
		};
	}

	private static async _addReportsImmuneRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.message_reports;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be an immune role, as that would be pointless.`
			};
		}

		if (config.immune_roles.includes(role.id)) {
			return { error: `The role ${role} is already an immune role.` };
		}

		const updatedRoles = [...config.immune_roles, role.id];

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				immune_roles: updatedRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully added the role ${role} to immune roles.`
		};
	}

	private static async _removeReportsImmuneRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.message_reports;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be an immune role, so how would you expect me to remove it?`
			};
		}

		if (!config.immune_roles.includes(role.id)) {
			return { error: `The role ${role} is not an immune role.` };
		}

		const updatedImmuneRoles = config.immune_roles.filter(id => id !== role.id);

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				immune_roles: updatedImmuneRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully removed the role ${role} from immune roles.`
		};
	}

	private static async _listReportImmuneRoles(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.message_reports;

		if (!config.immune_roles.length) {
			return { content: "There are no immune roles configured for message reports." };
		}

		const roleMentions = config.immune_roles.map(id => `<@&${id}>`).join("\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Message Report Immune Roles in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(roleMentions)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _addReportNotifyRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const roleIdentifier = interaction.options.getString("role", true);
		const config = configClass.data.message_reports;

		const role = interaction.guild.roles.cache.find(
			r => r.id === roleIdentifier || r.name === roleIdentifier
		);

		if (!role) {
			if (roleIdentifier !== "here")
				return { error: `No role found with the ID or name "${roleIdentifier}".` };

			if (config.notify_roles.includes("here")) {
				return { error: `The \`@here\` pseudo-role is already a notify role.` };
			}

			const updatedRoles = [...config.notify_roles, "here"];

			const updatedConfig = {
				...configClass.data,
				message_reports: {
					...configClass.data.message_reports,
					notify_roles: updatedRoles
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully added the \`@here\` pseudo-role to notify roles.`
			};
		}

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, as that would just be noisy.`
			};
		}

		if (config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is already a notify role.` };
		}

		const updatedRoles = [...config.notify_roles, role.id];

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				notify_roles: updatedRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully added the role ${role} to notify roles.`
		};
	}

	private static async _removeReportNotifyRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const roleIdentifier = interaction.options.getString("role", true);
		const config = configClass.data.message_reports;

		const role = interaction.guild.roles.cache.find(
			r => r.id === roleIdentifier || r.name === roleIdentifier
		);

		if (!role) {
			if (roleIdentifier !== "here")
				return { error: `No role found with the ID or name "${roleIdentifier}".` };

			if (!config.notify_roles.includes("here")) {
				return { error: `The \`@here\` pseudo-role is not a notify role.` };
			}

			const updatedNotifyRoles = config.notify_roles.filter(id => id !== "here");

			const updatedConfig = {
				...configClass.data,
				message_reports: {
					...configClass.data.message_reports,
					notify_roles: updatedNotifyRoles
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully removed the \`@here\` pseudo-role from notify roles.`
			};
		}

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, so how would you expect me to remove it?`
			};
		}

		if (!config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is not a notify role.` };
		}

		const updatedNotifyRoles = config.notify_roles.filter(id => id !== role.id);

		const updatedConfig = {
			...configClass.data,
			message_reports: {
				...configClass.data.message_reports,
				notify_roles: updatedNotifyRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully removed the role ${role} from notify roles.`
		};
	}

	private static async _listReportNotifyRoles(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.message_reports;

		if (config.notify_roles.length === 0) {
			return {
				content: "There are no notification roles configured for message reports."
			};
		}

		const roleMentions = config.notify_roles.map(id => `<@&${id}>`).join("\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Message Report Notification Roles in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(roleMentions)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _setReportReviewChannel(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.message_reports;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The review channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: client.user.displayAvatarURL(),
					name: client.user.username
				})
				.catch(() => null);

			if (!set) {
				return {
					error: "Failed to move the existing webhook to the specified channel."
				};
			}

			await kysely
				.updateTable("Guild")
				.set({
					config: {
						...configClass.data,
						message_reports: {
							...configClass.data.message_reports,
							webhook_channel: channel.id
						}
					}
				})
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully moved the review channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: client.user.username,
					avatar: client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await kysely
				.updateTable("Guild")
				.set({
					config: {
						...configClass.data,
						message_reports: {
							...configClass.data.message_reports,
							webhook_channel: channel.id,
							webhook_url: newWebhook.url
						}
					}
				})
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully set the review channel to ${channel}.`
			};
		}
	}

	private static async _toggleRequests(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.ban_requests;

		if (config.enabled === value) {
			return {
				error: `Ban requests are already ${value ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				enabled: value
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} ban requests.`
		};
	}

	private static async _toggleRequestNotifDM(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.ban_requests;

		if (config.notify_target === value) {
			return {
				error: `Notifications on DM are already ${value ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				notify_target: value
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} notifications on DM for ban requests.`
		};
	}

	private static async _setRequestMessageDeleteLimit(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const rawDuration = interaction.options.getString("duration", true);
		const config = configClass.data.ban_requests;

		if (rawDuration === "0") {
			if (!config.delete_message_seconds)
				return {
					error: "Message deletion is already disabled for ban requests."
				};

			const updatedConfig = {
				...configClass.data,
				ban_requests: {
					...configClass.data.ban_requests,
					delete_message_seconds: null
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: "Successfully disabled message deletion for ban requests."
			};
		}

		// Discord only accepts seconds.
		const duration = Math.floor(ms(rawDuration as ms.StringValue) / 1000);

		if (config.delete_message_seconds === duration)
			return {
				error: `The message deletion limit for ban requests is already set to ${rawDuration}.`
			};

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				delete_message_seconds: duration
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully set the message deletion limit for ban requests to ${rawDuration}.`
		};
	}

	private static async _disableRequestReasonField(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.ban_requests;

		if (config.disable_reason_field === value)
			return {
				error: `The reason field for ban requests is already ${value ? "disabled" : "enabled"}.`
			};

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				disable_reason_field: value
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${value ? "disabled" : "enabled"} the reason field for ban requests.`
		};
	}

	private static async _setRequestAdditionalInfo(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const rawInfo = interaction.options.getString("info", true);
		const config = configClass.data.ban_requests;

		if (config.additional_info === rawInfo) {
			return {
				error: `The additional info for ban requests is already set to: ${rawInfo}`
			};
		}

		const info = rawInfo.toLowerCase() === "none" ? null : rawInfo;

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				additional_info: info
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${info ? "set" : "cleared"} the additional info for ban requests.`
		};
	}

	private static async _toggleAutomaticallyTimeout(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.ban_requests;

		if (config.automatically_timeout === value) {
			return {
				error: `Automatic timeouts are already ${value ? "enabled" : "disabled"}.`
			};
		}

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				automatically_timeout: value
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} automatic timeouts for ban requests.`
		};
	}

	private static async _setRequestReviewChannel(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.ban_requests;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The review channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: client.user.displayAvatarURL(),
					name: client.user.username
				})
				.catch(() => null);

			if (!set) {
				return {
					error: "Failed to move the existing webhook to the specified channel."
				};
			}

			const updatedConfig = {
				...configClass.data,
				ban_requests: {
					...configClass.data.ban_requests,
					webhook_channel: channel.id
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully moved the review channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: client.user.username,
					avatar: client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			const updatedConfig = {
				...configClass.data,
				ban_requests: {
					...configClass.data.ban_requests,
					webhook_url: newWebhook.url,
					webhook_channel: channel.id
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully set the review channel to ${channel}.`
			};
		}
	}

	private static async _listRequestNotifyRoles(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.ban_requests;

		if (config.notify_roles.length === 0) {
			return { content: "There are no notification roles configured for ban requests." };
		}

		const roleMentions = config.notify_roles.map(id => `<@&${id}>`).join("\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Ban Request Notification Roles in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(roleMentions)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _addRequestNotifyRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const roleIdentifier = interaction.options.getString("role", true);
		const config = configClass.data.ban_requests;

		const role = interaction.guild.roles.cache.find(
			r => r.id === roleIdentifier || r.name === roleIdentifier
		);

		if (!role) {
			if (roleIdentifier !== "here")
				return { error: `No role found with the ID or name "${roleIdentifier}".` };

			if (config.notify_roles.includes("here")) {
				return { error: `The \`@here\` pseudo-role is already a notify role.` };
			}

			const updatedRoles = [...config.notify_roles, "here"];

			const updatedConfig = {
				...configClass.data,
				ban_requests: {
					...configClass.data.ban_requests,
					notify_roles: updatedRoles
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully added the \`@here\` pseudo-role to notify roles.`
			};
		}

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, as that would just be noisy.`
			};
		}

		if (config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is already a notify role.` };
		}

		const updatedRoles = [...config.notify_roles, role.id];

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				notify_roles: updatedRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully added the role ${role} to notify roles.`
		};
	}

	private static async _removeRequestNotifyRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const roleIdentifier = interaction.options.getString("role", true);
		const config = configClass.data.ban_requests;

		const role = interaction.guild.roles.cache.find(
			r => r.id === roleIdentifier || r.name === roleIdentifier
		);

		if (!role) {
			if (roleIdentifier !== "here")
				return { error: `No role found with the ID or name "${roleIdentifier}".` };

			if (!config.notify_roles.includes("here")) {
				return { error: `The \`@here\` pseudo-role is not a notify role.` };
			}

			const updatedNotifyRoles = config.notify_roles.filter(id => id !== "here");

			const updatedConfig = {
				...configClass.data,
				ban_requests: {
					...configClass.data.ban_requests,
					notify_roles: updatedNotifyRoles
				}
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", interaction.guild.id)
				.execute();

			return {
				content: `Successfully removed the \`@here\` pseudo-role from notify roles.`
			};
		}

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, so how would you expect me to remove it?`
			};
		}

		if (!config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is not a notify role.` };
		}

		const updatedNotifyRoles = config.notify_roles.filter(id => id !== role.id);

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				notify_roles: updatedNotifyRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully removed the role ${role} from notify roles.`
		};
	}

	private static async _listRequestImmuneRoles(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const config = configClass.data.ban_requests;

		if (!config.immune_roles.length) {
			return { content: "There are no immune roles configured for ban requests." };
		}

		const roleMentions = config.immune_roles.map(id => `<@&${id}>`).join("\n");

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Ban Request Immune Roles in ${interaction.guild.name}`,
				iconURL: interaction.guild.iconURL() ?? undefined
			})
			.setDescription(roleMentions)
			.setFooter({ text: `Guild ID: ${interaction.guildId}` })
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _addRequestImmuneRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.ban_requests;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be an immune role, as that would be pointless.`
			};
		}

		if (config.immune_roles.includes(role.id)) {
			return { error: `The role ${role} is already an immune role.` };
		}

		const updatedRoles = [...config.immune_roles, role.id];

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				immune_roles: updatedRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully added the role ${role} to immune roles.`
		};
	}

	private static async _removeRequestImmuneRole(
		interaction: ChatInputCommandInteraction<"cached">,
		configClass: GuildConfig
	): Promise<ResponseData<"interaction">> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.ban_requests;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be an immune role, so how would you expect me to remove it?`
			};
		}

		if (!config.immune_roles.includes(role.id)) {
			return { error: `The role ${role} is not an immune role.` };
		}

		const updatedImmuneRoles = config.immune_roles.filter(id => id !== role.id);

		const updatedConfig = {
			...configClass.data,
			ban_requests: {
				...configClass.data.ban_requests,
				immune_roles: updatedImmuneRoles
			}
		};

		await kysely
			.updateTable("Guild")
			.set({ config: updatedConfig })
			.where("id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully removed the role ${role} from immune roles.`
		};
	}
}

const ConfigSubcommandGroup = {
	Permissions: "permissions",
	Reports: "reports",
	Requests: "requests",
	Highlights: "highlights",
	QuickMutes: "quick-mutes",
	QuickPurges: "quick-purges",
	ContentFilter: "content-filter"
} as const;
type ConfigSubcommandGroup = (typeof ConfigSubcommandGroup)[keyof typeof ConfigSubcommandGroup];

const ConfigSubcommand = {
	Toggle: "toggle",
	ToggleDetector: "toggle-detector",
	ToggleNotifDM: "toggle-notif-dm",
	DisableReasonField: "disable-reason-field",
	SetMessageDeleteLimit: "set-message-delete-limit",
	SetAdditionalInfo: "set-additional-info",
	SetDetectorMode: "set-detector-mode",
	SetVerbosity: "set-verbosity",
	AddImmuneRole: "add-immune-role",
	RemoveImmuneRole: "remove-immune-role",
	ListImmuneRoles: "list-immune-roles",
	AddNotifyRole: "add-notify-role",
	RemoveNotifyRole: "remove-notify-role",
	ListNotifyRoles: "list-notify-roles",
	SetReviewChannel: "set-review-channel",
	SetDecisionChannel: "set-decision-channel",
	SetMaxPatterns: "set-max-patterns",
	SetLimit: "set-limit",
	SetPurgeLimit: "set-purge-limit",
	SetDefaultReason: "set-default-reason",
	AutomaticallyTimeout: "automatically-timeout",
	AddChannelScoping: "add-channel-scoping",
	RemoveChannelScoping: "remove-channel-scoping",
	ListChannelScopings: "list-channel-scoping",
	EnforceReason: "enforce-reason",
	DeleteOnHandle: "delete-on-handle",
	Create: "create",
	Delete: "delete",
	List: "list",
	Grant: "grant",
	Revoke: "revoke"
} as const;
type ConfigSubcommand = (typeof ConfigSubcommand)[keyof typeof ConfigSubcommand];
