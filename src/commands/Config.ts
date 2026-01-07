import {
	type ApplicationCommandData,
	type ChatInputCommandInteraction,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	Colors,
	EmbedBuilder,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits,
	roleMention
} from "discord.js";

import { UserPermission } from "#prisma/enums.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Command from "#managers/commands/Command.js";
import GuildConfig from "#managers/config/GuildConfig.js";
import ConfigManager from "#managers/config/ConfigManager.js";

export default class Config extends Command {
	public constructor() {
		super({
			name: "config",
			description: "Manage the guild configuration."
		});
	}

	public register(): ApplicationCommandData {
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
					description: "Manage permission scopes.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: ConfigSubcommand.Create,
							description: "Create a new permission scope.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "role",
									description: "The role to create the scope for.",
									type: ApplicationCommandOptionType.Role,
									required: true
								},
								{
									name: "permission",
									description: "The permission to assign to the scope.",
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
							description: "Delete an existing permission scope.",
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
							name: ConfigSubcommand.GrantPermission,
							description: "Add a permission to an existing scope.",
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
									description: "The permission to add to the scope.",
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
							name: ConfigSubcommand.RevokePermission,
							description: "Remove a permission from an existing scope.",
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
									description: "The permission to remove from the scope.",
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
				}
			]
		};
	}

	public async interactionRun(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const subcommandGroup = interaction.options.getSubcommandGroup() as ConfigSubcommandGroup;
		const subcommand = interaction.options.getSubcommand() as ConfigSubcommand;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const handlers: Record<string, () => Promise<InteractionReplyData>> = {
			// Permission Group
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.Create}`]: () =>
				this._createPermissionScope(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.Delete}`]: () =>
				this._deletePermissionScope(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.List}`]: () =>
				this._listPermissionScopes(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.GrantPermission}`]: () =>
				this._addPermissionToScope(interaction, config),
			[`${ConfigSubcommandGroup.Permissions}:${ConfigSubcommand.RevokePermission}`]: () =>
				this._removePermissionFromScope(interaction, config)
		};

		const handler = handlers[`${subcommandGroup}:${subcommand}`];
		return handler ? handler() : { error: "Unknown subcommand." };
	}

	private async _createPermissionScope(
		interaction: ChatInputCommandInteraction<"cached">,
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
		interaction: ChatInputCommandInteraction<"cached">,
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
		interaction: ChatInputCommandInteraction<"cached">,
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
		interaction: ChatInputCommandInteraction<"cached">,
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
		interaction: ChatInputCommandInteraction<"cached">,
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
}

const ConfigSubcommandGroup = {
	Permissions: "permission-scopes"
} as const;
type ConfigSubcommandGroup = (typeof ConfigSubcommandGroup)[keyof typeof ConfigSubcommandGroup];

const ConfigSubcommand = {
	Create: "create",
	Delete: "delete",
	List: "list",
	GrantPermission: "grant-permission",
	RevokePermission: "revoke-permission"
} as const;
type ConfigSubcommand = (typeof ConfigSubcommand)[keyof typeof ConfigSubcommand];
