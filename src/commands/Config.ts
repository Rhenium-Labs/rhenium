import {
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

import { ApplyOptions, Command } from "#rhenium";
import { ContentFilterVerbosity, Detector, DetectorMode, UserPermission } from "#prisma/enums.js";
import type { InteractionReplyData } from "#utils/Types.js";

import GuildConfig from "#managers/config/GuildConfig.js";
import ConfigManager from "#managers/config/ConfigManager.js";

@ApplyOptions<Command.Options>({
	name: "config",
	description: "Manage the guild configuration."
})
export default class Config extends Command {
	public register(): Command.Data {
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
									choices: Object.values(UserPermission).map(permission => ({
										name: permission,
										value: permission
									}))
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
									choices: Object.values(UserPermission).map(permission => ({
										name: permission,
										value: permission
									}))
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
									choices: Object.values(UserPermission).map(permission => ({
										name: permission,
										value: permission
									}))
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
							description: "Enforce reporters to provide a reason when reporting messages.",
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
							name: ConfigSubcommand.SetLogChannel,
							description: "Set the log channel for reports.",
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
									type: ApplicationCommandOptionType.Role,
									required: true
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
									type: ApplicationCommandOptionType.Role,
									required: true
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
							name: ConfigSubcommand.SetLogChannel,
							description: "Set the log channel for ban requests.",
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
							name: ConfigSubcommand.SetDecisionChannel,
							description: "Set the decision channel for ban requests.",
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
							description: "List all roles notified on ban request submission.",
							type: ApplicationCommandOptionType.Subcommand
						},
						{
							name: ConfigSubcommand.AddNotifyRole,
							description: "Add a role to be notified on ban request submission.",
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
							name: ConfigSubcommand.RemoveNotifyRole,
							description: "Remove a role from ban request creation notifications.",
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
							description: "Set the maximum number of highlight patterns per user.",
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
							description: "Set the maximum number of messages that can be purged at once.",
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
									description: "Include or exclude quick purges in this channel.",
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
						},
						{
							name: ConfigSubcommand.SetLogChannel,
							description: "Set the log channel for quick purges.",
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
							name: ConfigSubcommand.SetResultChannel,
							description: "Set the result channel for quick purges.",
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
							description: "Set the maximum number of messages that can be purged at once.",
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
									description: "Include or exclude quick mutes in this channel.",
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
						},
						{
							name: ConfigSubcommand.SetLogChannel,
							description: "Set the log channel for quick mutes.",
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
							name: ConfigSubcommand.SetResultChannel,
							description: "Set the result channel for quick mutes.",
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
							description: "Set the channel where new content filter alerts are sent.",
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
									description: "Include or exclude the content filter in this channel.",
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
							description: "Remove a channel from content filter channel scopes.",
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
							description: "Set the verbosity level for content filter alerts.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "level",
									description: "The verbosity level.",
									type: ApplicationCommandOptionType.String,
									required: true,
									choices: Object.values(ContentFilterVerbosity).map(level => ({
										name: level,
										value: level
									}))
								}
							]
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
		const subcommandGroup = interaction.options.getSubcommandGroup() as ConfigSubcommandGroup;
		const subcommand = interaction.options.getSubcommand() as ConfigSubcommand;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const handlers: Record<string, () => Promise<InteractionReplyData>> = {
			// Highlights Group
			[`${ConfigSubcommandGroup.Highlights}:${ConfigSubcommand.SetMaxPatterns}`]: () =>
				this._setMaxHighlightPatterns(interaction, config),
			[`${ConfigSubcommandGroup.Highlights}:${ConfigSubcommand.Toggle}`]: () =>
				this._toggleHighlights(interaction, config),

			// Quick Mutes Group
			[`${ConfigSubcommandGroup.QuickMutes}:${ConfigSubcommand.Toggle}`]: () =>
				this._toggleQuickMutes(interaction, config),
			[`${ConfigSubcommandGroup.QuickMutes}:${ConfigSubcommand.SetLogChannel}`]: () =>
				this._setQuickMuteLogChannel(interaction, config),
			[`${ConfigSubcommandGroup.QuickMutes}:${ConfigSubcommand.SetResultChannel}`]: () =>
				this._setQuickMuteResultChannel(interaction, config),
			[`${ConfigSubcommandGroup.QuickMutes}:${ConfigSubcommand.SetPurgeLimit}`]: () =>
				this._setQuickMutePurgeLimit(interaction, config),
			[`${ConfigSubcommandGroup.QuickMutes}:${ConfigSubcommand.AddChannelScoping}`]: () =>
				this._addQuickMuteChannelScoping(interaction, config),
			[`${ConfigSubcommandGroup.QuickMutes}:${ConfigSubcommand.RemoveChannelScoping}`]: () =>
				this._removeQuickMuteChannelScoping(interaction, config),
			[`${ConfigSubcommandGroup.QuickMutes}:${ConfigSubcommand.ListChannelScopings}`]: () =>
				this._listQuickMuteChannelScopings(interaction, config),

			// Quick Purges Group
			[`${ConfigSubcommandGroup.QuickPurges}:${ConfigSubcommand.Toggle}`]: () =>
				this._toggleQuickPurges(interaction, config),
			[`${ConfigSubcommandGroup.QuickPurges}:${ConfigSubcommand.SetLogChannel}`]: () =>
				this._setQuickPurgeLogChannel(interaction, config),
			[`${ConfigSubcommandGroup.QuickPurges}:${ConfigSubcommand.SetResultChannel}`]: () =>
				this._setQuickPurgeResultChannel(interaction, config),
			[`${ConfigSubcommandGroup.QuickPurges}:${ConfigSubcommand.SetLimit}`]: () =>
				this._setQuickPurgeLimit(interaction, config),
			[`${ConfigSubcommandGroup.QuickPurges}:${ConfigSubcommand.AddChannelScoping}`]: () =>
				this._addQuickPurgeChannelScoping(interaction, config),
			[`${ConfigSubcommandGroup.QuickPurges}:${ConfigSubcommand.RemoveChannelScoping}`]: () =>
				this._removeQuickPurgeChannelScoping(interaction, config),
			[`${ConfigSubcommandGroup.QuickPurges}:${ConfigSubcommand.ListChannelScopings}`]: () =>
				this._listQuickPurgeChannelScopings(interaction, config),

			// Permission Group
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.Create}`]: () =>
				this._createPermissionScope(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.Delete}`]: () =>
				this._deletePermissionScope(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.List}`]: () =>
				this._listPermissionScopes(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.Grant}`]: () =>
				this._addPermissionToScope(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.Revoke}`]: () =>
				this._removePermissionFromScope(interaction, config),

			// Message Reports Group
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.EnforceReason}`]: () =>
				this._toggleReportsEnforceReason(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.AddImmuneRole}`]: () =>
				this._addReportsImmuneRole(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.SetDefaultReason}`]: () =>
				this._setReportsDefaultReason(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.RemoveImmuneRole}`]: () =>
				this._removeReportsImmuneRole(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.ListImmuneRoles}`]: () =>
				this._listReportImmuneRoles(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.AddNotifyRole}`]: () =>
				this._addReportNotifyRole(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.RemoveNotifyRole}`]: () =>
				this._removeReportNotifyRole(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.ListNotifyRoles}`]: () =>
				this._listReportNotifyRoles(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.Toggle}`]: () =>
				this._toggleReports(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.SetReviewChannel}`]: () =>
				this._setReportReviewChannel(interaction, config),
			[`${ConfigSubcommandGroup.Reports}:${ConfigSubcommand.SetLogChannel}`]: () =>
				this._setReportLogChannel(interaction, config),

			// Ban Requests Group
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.Toggle}`]: () =>
				this._toggleRequests(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.SetReviewChannel}`]: () =>
				this._setRequestReviewChannel(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.SetDecisionChannel}`]: () =>
				this._setRequestDecisionChannel(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.SetLogChannel}`]: () =>
				this._setRequestLogChannel(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.AutomaticallyTimeout}`]: () =>
				this._toggleAutomaticallyTimeout(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.AddImmuneRole}`]: () =>
				this._addRequestImmuneRole(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.RemoveImmuneRole}`]: () =>
				this._removeRequestImmuneRole(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.ListImmuneRoles}`]: () =>
				this._listRequestImmuneRoles(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.AddNotifyRole}`]: () =>
				this._addRequestNotifyRole(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.RemoveNotifyRole}`]: () =>
				this._removeRequestNotifyRole(interaction, config),
			[`${ConfigSubcommandGroup.Requests}:${ConfigSubcommand.ListNotifyRoles}`]: () =>
				this._listRequestNotifyRoles(interaction, config),

			// Content Filter Group
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.Toggle}`]: () =>
				this._toggleContentFilter(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.SetReviewChannel}`]: () =>
				this._setContentFilterReviewChannel(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.AddImmuneRole}`]: () =>
				this._addContentFilterImmuneRole(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.RemoveImmuneRole}`]: () =>
				this._removeContentFilterImmuneRole(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.ListImmuneRoles}`]: () =>
				this._listContentFilterImmuneRoles(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.AddChannelScoping}`]: () =>
				this._addContentFilterChannelScoping(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.RemoveChannelScoping}`]: () =>
				this._removeContentFilterChannelScoping(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.ListChannelScopings}`]: () =>
				this._listContentFilterChannelScopings(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.ToggleDetector}`]: () =>
				this._toggleContentFilterDetector(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.SetDetectorMode}`]: () =>
				this.setContentFilterDetectorMode(interaction, config),
			[`${ConfigSubcommandGroup.ContentFilter}:${ConfigSubcommand.SetVerbosity}`]: () =>
				this._setContentFilterVerbosity(interaction, config)
		};

		const handler = handlers[`${subcommandGroup}:${subcommand}`];
		return handler ? handler() : { error: "Unknown subcommand." };
	}

	private async setContentFilterDetectorMode(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const mode = interaction.options.getString("mode", true) as DetectorMode;
		const currentMode = configClass.data.content_filter.detector_mode;

		if (mode === currentMode) {
			return { error: `Content filter detector mode is already set to ${mode}.` };
		}

		await this.prisma.contentFilterConfig.update({
			where: { id: interaction.guild.id },
			data: { detector_mode: mode }
		});

		return { content: `Successfully set content filter detector mode to ${mode}.` };
	}

	private async _setContentFilterVerbosity(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const level = interaction.options.getString("level", true) as ContentFilterVerbosity;
		const currentLevel = configClass.data.content_filter.verbosity;

		if (level === currentLevel) {
			return { error: `Content filter verbosity is already set to ${level}.` };
		}

		await this.prisma.contentFilterConfig.update({
			where: { id: interaction.guild.id },
			data: { verbosity: level }
		});

		return { content: `Successfully set content filter verbosity to ${level}.` };
	}

	private async _toggleContentFilterDetector(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const detector = interaction.options.getString("detector", true) as Detector;
		const enable = interaction.options.getBoolean("value", true);
		const currentDetectors = configClass.data.content_filter.detectors;

		if (enable && currentDetectors.includes(detector)) {
			return { error: `The ${detector} detector is already enabled.` };
		}

		if (!enable && !currentDetectors.includes(detector)) {
			return { error: `The ${detector} detector is already disabled.` };
		}

		const updatedDetectors = enable
			? [...currentDetectors, detector]
			: currentDetectors.filter(d => d !== detector);

		await this.prisma.contentFilterConfig.update({
			where: { id: interaction.guild.id },
			data: { detectors: updatedDetectors }
		});

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} the ${detector} detector.`
		};
	}

	private async _toggleContentFilter(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.content_filter.enabled;

		if (enable === current) {
			return {
				error: `Content filter is already ${enable ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.contentFilterConfig.update({
			where: { id: interaction.guild.id },
			data: { enabled: enable }
		});

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} the content filter.`
		};
	}

	private async _setContentFilterReviewChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the content filter review channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.contentFilterConfig.update({
				where: { id: interaction.guild.id },
				data: { webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the content filter review channel to ${channel}.`
			};
		}
	}

	private async _addContentFilterImmuneRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.content_filter;

		if (config.immune_roles.includes(role.id)) {
			return { error: `${role} is already immune to the content filter.` };
		}

		const updatedRoles = [...config.immune_roles, role.id];

		await this.prisma.contentFilterConfig.update({
			where: { id: interaction.guild.id },
			data: { immune_roles: updatedRoles }
		});

		return { content: `Successfully added ${role} to content filter immune roles.` };
	}

	private async _removeContentFilterImmuneRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.content_filter;

		if (!config.immune_roles.includes(role.id)) {
			return { error: `${role} is not immune to the content filter.` };
		}

		const updatedRoles = config.immune_roles.filter(r => r !== role.id);

		await this.prisma.contentFilterConfig.update({
			where: { id: interaction.guild.id },
			data: { immune_roles: updatedRoles }
		});

		return { content: `Successfully removed ${role} from content filter immune roles.` };
	}

	private async _listContentFilterImmuneRoles(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

	private async _addContentFilterChannelScoping(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.content_filter;
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getNumber("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		if (config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is already scoped` };
		}

		await this.prisma.contentFilterChannelScoping.create({
			data: {
				guild_id: interaction.guildId,
				channel_id: channel.id,
				type: scopeType
			}
		});

		return {
			content: `Successfully added the channel ${channel} to content filter channel scoping as an \`${stringifiedType}\` channel.`
		};
	}

	private async _removeContentFilterChannelScoping(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.content_filter;
		const channel = interaction.options.getChannel("channel", true);

		if (!config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is not scoped.` };
		}

		await this.prisma.contentFilterChannelScoping.deleteMany({
			where: { guild_id: interaction.guildId, channel_id: channel.id }
		});

		return {
			content: `Successfully removed the channel ${channel} from content filter channel scoping.`
		};
	}

	private async _listContentFilterChannelScopings(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.content_filter;
		const scopings = config.channel_scoping;

		if (scopings.length === 0) {
			return { content: "There are no content filter channel scopings configured for this guild." };
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

	private async _toggleQuickMutes(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.quick_mutes.enabled;

		if (enable === current) {
			return {
				error: `Quick mutes are already ${enable ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.quickMuteConfig.update({
			where: { id: interaction.guild.id },
			data: { enabled: enable }
		});

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} quick mutes.`
		};
	}

	private async _toggleQuickPurges(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.quick_purges.enabled;

		if (enable === current) {
			return {
				error: `Quick purges are already ${enable ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.quickPurgeConfig.update({
			where: { id: interaction.guild.id },
			data: { enabled: enable }
		});

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} quick purges.`
		};
	}

	private async _toggleHighlights(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const enable = interaction.options.getBoolean("value", true);
		const current = configClass.data.highlights.enabled;

		if (enable === current) {
			return {
				error: `Highlights are already ${enable ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.highlightConfig.update({
			where: { id: interaction.guild.id },
			data: { enabled: enable }
		});

		return {
			content: `Successfully ${enable ? "enabled" : "disabled"} highlights.`
		};
	}

	private async _setQuickPurgeLogChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.quick_purges;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The quick purge log channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the quick purge log channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.quickPurgeConfig.update({
				where: { id: interaction.guild.id },
				data: { webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the quick purge log channel to ${channel}.`
			};
		}
	}

	private async _setQuickPurgeResultChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.quick_purges;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.result_webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The quick purge result channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the quick purge result channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.quickPurgeConfig.update({
				where: { id: interaction.guild.id },
				data: { result_webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the quick purge result channel to ${channel}.`
			};
		}
	}

	private async _setQuickMuteLogChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.quick_mutes;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The quick mute log channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the quick mute log channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.quickMuteConfig.update({
				where: { id: interaction.guild.id },
				data: { webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the quick mute log channel to ${channel}.`
			};
		}
	}

	private async _setQuickMuteResultChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.quick_mutes;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.result_webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The quick mute result channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the quick mute result channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.quickMuteConfig.update({
				where: { id: interaction.guild.id },
				data: { result_webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the quick mute result channel to ${channel}.`
			};
		}
	}

	private async _setQuickMutePurgeLimit(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const amount = interaction.options.getInteger("amount", true);
		const config = configClass.data.quick_mutes;

		if (config.purge_limit === amount) {
			return {
				error: `The quick mute purge limit is already set to ${amount}.`
			};
		}

		await this.prisma.quickMuteConfig.update({
			where: { id: interaction.guild.id },
			data: { purge_limit: amount }
		});

		return {
			content: `Successfully set the quick mute purge limit to ${amount}.`
		};
	}

	private async _addQuickMuteChannelScoping(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.quick_mutes;
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getNumber("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		if (config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is already scoped` };
		}

		await this.prisma.quickMuteChannelScoping.create({
			data: {
				guild_id: interaction.guildId,
				channel_id: channel.id,
				type: scopeType
			}
		});

		return {
			content: `Successfully added the channel ${channel} to quick mute scoping as an \`${stringifiedType}\` channel.`
		};
	}

	private async _removeQuickMuteChannelScoping(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.quick_mutes;
		const channel = interaction.options.getChannel("channel", true);

		const scope = config.channel_scoping.find(s => s.channel_id === channel.id);

		if (!scope) {
			return { error: `The channel ${channel} is not scoped.` };
		}

		await this.prisma.quickMuteChannelScoping.deleteMany({
			where: {
				guild_id: interaction.guildId,
				channel_id: channel.id
			}
		});

		return {
			content: `Successfully removed the channel ${channel} from quick mute scoping.`
		};
	}

	private async _listQuickMuteChannelScopings(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.quick_mutes;
		const scopings = config.channel_scoping;

		if (scopings.length === 0) {
			return { content: "There are no quick mute channel scopings configured for this guild." };
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

	private async _setQuickPurgeLimit(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const amount = interaction.options.getInteger("amount", true);
		const config = configClass.data.quick_purges;

		if (config.max_limit === amount) {
			return {
				error: `The quick purge limit is already set to ${amount}.`
			};
		}

		await this.prisma.quickPurgeConfig.update({
			where: { id: interaction.guild.id },
			data: { max_limit: amount }
		});

		return {
			content: `Successfully set the quick purge limit to ${amount}.`
		};
	}

	private async _addQuickPurgeChannelScoping(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.quick_purges;
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getNumber("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		if (config.channel_scoping.some(s => s.channel_id === channel.id)) {
			return { error: `The channel ${channel} is already scoped` };
		}

		await this.prisma.quickPurgeChannelScoping.create({
			data: {
				guild_id: interaction.guildId,
				channel_id: channel.id,
				type: scopeType
			}
		});

		return {
			content: `Successfully added the channel ${channel} to quick purge scoping as an \`${stringifiedType}\` channel.`
		};
	}

	private async _removeQuickPurgeChannelScoping(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.quick_purges;
		const channel = interaction.options.getChannel("channel", true);

		const scope = config.channel_scoping.find(s => s.channel_id === channel.id);

		if (!scope) {
			return { error: `The channel ${channel} is not scoped.` };
		}

		await this.prisma.quickPurgeChannelScoping.deleteMany({
			where: {
				guild_id: interaction.guildId,
				channel_id: channel.id
			}
		});

		return {
			content: `Successfully removed the channel ${channel} from quick purge scoping.`
		};
	}

	private async _listQuickPurgeChannelScopings(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.quick_purges;
		const scopings = config.channel_scoping;

		if (scopings.length === 0) {
			return { content: "There are no quick purge channel scopings configured for this guild." };
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

	private async _setMaxHighlightPatterns(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const amount = interaction.options.getInteger("amount", true);
		const config = configClass.data.highlights;

		if (config.max_patterns === amount) {
			return {
				error: `The maximum number of highlight patterns is already set to ${amount}.`
			};
		}

		await this.prisma.highlightConfig.update({
			where: { id: interaction.guild.id },
			data: { max_patterns: amount }
		});

		return {
			content: `Successfully set the maximum number of highlight patterns to ${amount}.`
		};
	}

	private async _createPermissionScope(
		interaction: Command.Interaction<"chatInput">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const permission = interaction.options.getString("permission", true) as UserPermission;

		const exists = await this.prisma.permissionScope.findUnique({
			where: {
				guild_id_role_id: {
					guild_id: interaction.guildId,
					role_id: role.id
				}
			}
		});

		if (exists) {
			return { error: `A permission scope for the role ${role} already exists.` };
		}

		const updatedScopes = [
			...config.data.permission_scopes,
			{
				guild_id: interaction.guildId,
				role_id: role.id,
				allowed_permissions: [permission]
			}
		];

		await Promise.all([
			this.prisma.permissionScope.create({
				data: {
					guild_id: interaction.guildId,
					role_id: role.id,
					allowed_permissions: [permission]
				}
			}),
			ConfigManager.updateCachedConfig(interaction.guildId, "permission_scopes", updatedScopes)
		]);

		return { content: `Successfully created a permission scope for the ${role} role.` };
	}

	private async _deletePermissionScope(
		interaction: Command.Interaction<"chatInput">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);

		const scope = await this.prisma.permissionScope.findUnique({
			where: {
				guild_id_role_id: {
					guild_id: interaction.guildId,
					role_id: role.id
				}
			}
		});

		if (!scope) {
			return { error: `No permission scope found for the role ${role}.` };
		}

		const updatedScopes = config.data.permission_scopes.filter(s => s.role_id !== role.id);

		await Promise.all([
			this.prisma.permissionScope.delete({
				where: {
					guild_id_role_id: {
						guild_id: interaction.guildId,
						role_id: role.id
					}
				}
			}),
			ConfigManager.updateCachedConfig(interaction.guildId, "permission_scopes", updatedScopes)
		]);

		return { content: `Successfully deleted the permission scope for the ${role} role.` };
	}

	private async _listPermissionScopes(
		interaction: Command.Interaction<"chatInput">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const scopes = config.data.permission_scopes;

		if (scopes.length === 0) {
			return { content: "There are no permission scopes configured for this guild." };
		}

		const description = scopes
			.map(scope => {
				const roleMentionStr = roleMention(scope.role_id);
				const permissionsStr = scope.allowed_permissions.map(p => `\`${p}\``).join(", ");

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

	private async _addPermissionToScope(
		interaction: Command.Interaction<"chatInput">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const permission = interaction.options.getString("permission", true) as UserPermission;

		const scope = await this.prisma.permissionScope.findUnique({
			where: {
				guild_id_role_id: {
					guild_id: interaction.guildId,
					role_id: role.id
				}
			}
		});

		if (!scope) {
			return { error: `No permission scope found for the role ${role}.` };
		}

		if (scope.allowed_permissions.includes(permission)) {
			return {
				error: `The permission \`${permission}\` is already assigned to the scope for the role ${role}.`
			};
		}

		const updatedScopes = config.data.permission_scopes.map(s => {
			if (s.role_id === role.id) {
				return {
					...s,
					allowed_permissions: [...s.allowed_permissions, permission]
				};
			}
			return s;
		});

		await Promise.all([
			this.prisma.permissionScope.update({
				where: {
					guild_id_role_id: {
						guild_id: interaction.guildId,
						role_id: role.id
					}
				},
				data: {
					allowed_permissions: {
						push: permission
					}
				}
			}),
			ConfigManager.updateCachedConfig(interaction.guildId, "permission_scopes", updatedScopes)
		]);

		return {
			content: `Successfully added the permission \`${permission}\` to the scope for the role ${role}.`
		};
	}

	private async _removePermissionFromScope(
		interaction: Command.Interaction<"chatInput">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const permission = interaction.options.getString("permission", true) as UserPermission;

		const scope = await this.prisma.permissionScope.findUnique({
			where: {
				guild_id_role_id: {
					guild_id: interaction.guildId,
					role_id: role.id
				}
			}
		});

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

		const updatedScopes = config.data.permission_scopes.map(s => {
			if (s.role_id === role.id) {
				return {
					...s,
					allowed_permissions: s.allowed_permissions.filter(p => p !== permission)
				};
			}
			return s;
		});

		await Promise.all([
			this.prisma.permissionScope.update({
				where: {
					guild_id_role_id: {
						guild_id: interaction.guildId,
						role_id: role.id
					}
				},
				data: {
					allowed_permissions: scope.allowed_permissions.filter(p => p !== permission)
				}
			}),
			ConfigManager.updateCachedConfig(interaction.guildId, "permission_scopes", updatedScopes)
		]);

		return {
			content: `Successfully removed the permission \`${permission}\` from the scope for the role ${role}.`
		};
	}

	private async _toggleReports(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.message_reports;

		if (config.enabled === value) {
			return {
				error: `Message reports are already ${value ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.messageReportConfig.update({
			where: { id: interaction.guild.id },
			data: { enabled: value }
		});

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} message reports.`
		};
	}

	private async _setReportsDefaultReason(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const rawReason = interaction.options.getString("reason", true);
		const config = configClass.data.message_reports;

		if (config.placeholder_reason === rawReason) {
			return {
				error: `The default reason for message reports is already set to: ${rawReason}`
			};
		}

		const reason = rawReason.toLowerCase() === "none" ? null : rawReason;

		await this.prisma.messageReportConfig.update({
			where: { id: interaction.guild.id },
			data: { placeholder_reason: reason }
		});

		return {
			content: `Successfully ${reason ? "set" : "cleared"} the default reason for message reports.`
		};
	}

	private async _toggleReportsEnforceReason(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.message_reports;

		if (config.enforce_report_reason === value) {
			return {
				error: `Message report reason enforcement is already ${value ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.messageReportConfig.update({
			where: { id: interaction.guild.id },
			data: { enforce_report_reason: value }
		});

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} message report reason enforcement.`
		};
	}

	private async _addReportsImmuneRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

		await this.prisma.messageReportConfig.update({
			where: { id: interaction.guild.id },
			data: { immune_roles: { push: role.id } }
		});

		return {
			content: `Successfully added the role ${role} to immune roles.`
		};
	}

	private async _removeReportsImmuneRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

		await this.prisma.messageReportConfig.update({
			where: { id: interaction.guild.id },
			data: {
				immune_roles: updatedImmuneRoles
			}
		});

		return {
			content: `Successfully removed the role ${role} from immune roles.`
		};
	}

	private async _listReportImmuneRoles(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

	private async _addReportNotifyRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.message_reports;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, as that would just be noisy.`
			};
		}

		if (config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is already a notify role.` };
		}

		await this.prisma.messageReportConfig.update({
			where: { id: interaction.guild.id },
			data: { notify_roles: { push: role.id } }
		});

		return {
			content: `Successfully added the role ${role} to notify roles.`
		};
	}

	private async _removeReportNotifyRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.message_reports;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, so how would you expect me to remove it?`
			};
		}

		if (!config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is not a notify role.` };
		}

		const updatedNotifyRoles = config.notify_roles.filter(id => id !== role.id);

		await this.prisma.messageReportConfig.update({
			where: { id: interaction.guild.id },
			data: {
				notify_roles: updatedNotifyRoles
			}
		});

		return {
			content: `Successfully removed the role ${role} from notify roles.`
		};
	}

	private async _listReportNotifyRoles(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const config = configClass.data.message_reports;

		if (config.notify_roles.length === 0) {
			return { content: "There are no notification roles configured for message reports." };
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

	private async _setReportReviewChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the review channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.messageReportConfig.update({
				where: { id: interaction.guild.id },
				data: { webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the review channel to ${channel}.`
			};
		}
	}

	private async _setReportLogChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.message_reports;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.log_webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The log channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the log channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.messageReportConfig.update({
				where: { id: interaction.guild.id },
				data: { log_webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the log channel to ${channel}.`
			};
		}
	}

	private async _toggleRequests(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.ban_requests;

		if (config.enabled === value) {
			return {
				error: `Ban requests are already ${value ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.banRequestConfig.update({
			where: { id: interaction.guild.id },
			data: { enabled: value }
		});

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} ban requests.`
		};
	}

	private async _toggleAutomaticallyTimeout(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const value = interaction.options.getBoolean("value", true);
		const config = configClass.data.ban_requests;

		if (config.automatically_timeout === value) {
			return {
				error: `Automatic timeouts are already ${value ? "enabled" : "disabled"}.`
			};
		}

		await this.prisma.banRequestConfig.update({
			where: { id: interaction.guild.id },
			data: { automatically_timeout: value }
		});

		return {
			content: `Successfully ${value ? "enabled" : "disabled"} automatic timeouts for ban requests.`
		};
	}

	private async _setRequestReviewChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the review channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.banRequestConfig.update({
				where: { id: interaction.guild.id },
				data: { webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the review channel to ${channel}.`
			};
		}
	}

	private async _setRequestDecisionChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.ban_requests;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.decision_webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The decision channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the decision channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.banRequestConfig.update({
				where: { id: interaction.guild.id },
				data: { decision_webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the decision channel to ${channel}.`
			};
		}
	}

	private async _setRequestLogChannel(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true, [ChannelType.GuildText]);
		const config = configClass.data.ban_requests;

		const webhooks = await interaction.guild.fetchWebhooks();
		const webhook = webhooks.find(wh => wh.url === config.log_webhook_url);

		if (webhook) {
			if (webhook.channelId === channel.id) {
				return {
					error: `The log channel is already set to ${channel}.`
				};
			}

			const set = await webhook
				.edit({
					channel: channel.id,
					avatar: this.client.user.displayAvatarURL(),
					name: this.client.user.username
				})
				.catch(() => null);

			if (!set) {
				return { error: "Failed to move the existing webhook to the specified channel." };
			}

			return {
				content: `Successfully moved the log channel webhook to ${channel}.`
			};
		} else {
			const newWebhook = await channel
				.createWebhook({
					name: this.client.user.username,
					avatar: this.client.user.displayAvatarURL()
				})
				.catch(() => null);

			if (!newWebhook) {
				return { error: "Failed to create a webhook in the specified channel." };
			}

			await this.prisma.banRequestConfig.update({
				where: { id: interaction.guild.id },
				data: { log_webhook_url: newWebhook.url }
			});

			return {
				content: `Successfully set the log channel to ${channel}.`
			};
		}
	}

	private async _listRequestNotifyRoles(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

	private async _addRequestNotifyRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.ban_requests;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, as that would just be noisy.`
			};
		}

		if (config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is already a notify role.` };
		}

		await this.prisma.banRequestConfig.update({
			where: { id: interaction.guild.id },
			data: { notify_roles: { push: role.id } }
		});

		return {
			content: `Successfully added the role ${role} to notify roles.`
		};
	}

	private async _removeRequestNotifyRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
		const role = interaction.options.getRole("role", true);
		const config = configClass.data.ban_requests;

		if (role.id === interaction.guild.id) {
			return {
				error: `The @everyone role cannot be made a notify role, so how would you expect me to remove it?`
			};
		}

		if (!config.notify_roles.includes(role.id)) {
			return { error: `The role ${role} is not a notify role.` };
		}

		const updatedNotifyRoles = config.notify_roles.filter(id => id !== role.id);

		await this.prisma.banRequestConfig.update({
			where: { id: interaction.guild.id },
			data: {
				notify_roles: updatedNotifyRoles
			}
		});

		return {
			content: `Successfully removed the role ${role} from notify roles.`
		};
	}

	private async _listRequestImmuneRoles(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

	private async _addRequestImmuneRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

		await this.prisma.banRequestConfig.update({
			where: { id: interaction.guild.id },
			data: { immune_roles: { push: role.id } }
		});

		return {
			content: `Successfully added the role ${role} to immune roles.`
		};
	}

	private async _removeRequestImmuneRole(
		interaction: Command.Interaction<"chatInput">,
		configClass: GuildConfig
	): Promise<InteractionReplyData> {
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

		await this.prisma.banRequestConfig.update({
			where: { id: interaction.guild.id },
			data: {
				immune_roles: updatedImmuneRoles
			}
		});

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
	SetLogChannel: "set-log-channel",
	SetResultChannel: "set-result-channel",
	SetDefaultReason: "set-default-reason",
	AutomaticallyTimeout: "automatically-timeout",
	AddChannelScoping: "add-channel-scoping",
	RemoveChannelScoping: "remove-channel-scoping",
	ListChannelScopings: "list-channel-scoping",
	EnforceReason: "enforce-reason",
	Create: "create",
	Delete: "delete",
	List: "list",
	Grant: "grant",
	Revoke: "revoke"
} as const;
type ConfigSubcommand = (typeof ConfigSubcommand)[keyof typeof ConfigSubcommand];
