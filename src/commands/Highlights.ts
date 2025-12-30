import {
	ApplicationCommandData,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	ChatInputCommandInteraction,
	Colors,
	EmbedBuilder,
	InteractionContextType,
	MessageFlags
} from "discord.js";

import safe from "safe-regex";

import { prisma } from "#root/index.js";
import { inflect } from "#utils/index.js";
import { Command } from "#classes/Command.js";

import type { InteractionReplyData } from "#utils/Types.js";

export default class Highlights extends Command {
	public constructor() {
		super({
			name: "highlights",
			description: "Manage your message highlights."
		});
	}

	public register(): ApplicationCommandData {
		return {
			name: this.name,
			description: this.description,
			type: ApplicationCommandType.ChatInput,
			contexts: [InteractionContextType.Guild],
			integrationTypes: [ApplicationIntegrationType.GuildInstall],
			options: [
				{
					name: HighlightSubcommandGroup.Pattern,
					description: "Manage highlight patterns.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: HighlightSubcommand.Add,
							description: "Add a highlight pattern.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "pattern",
									description: "The pattern to add.",
									type: ApplicationCommandOptionType.String,
									required: true,
									max_length: 45
								}
							]
						},
						{
							name: HighlightSubcommand.Remove,
							description: "Remove a highlight pattern.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "pattern",
									description: "The pattern to remove.",
									type: ApplicationCommandOptionType.String,
									required: true,
									max_length: 45
								}
							]
						},
						{
							name: HighlightSubcommand.Clear,
							description: "Clear all highlight patterns.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: HighlightSubcommandGroup.ChannelScoping,
					description: "Manage your highlight channel scoping.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: HighlightSubcommand.Add,
							description: "Add a channel to your highlight scoping.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel to add.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								},
								{
									name: "type",
									description: "Include or exclude highlights from this channel.",
									type: ApplicationCommandOptionType.Integer,
									required: true,
									choices: [
										{ name: "Include", value: 0 },
										{ name: "Exclude", value: 1 }
									]
								}
							]
						},
						{
							name: HighlightSubcommand.Remove,
							description: "Remove a channel from your highlight scoping.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "channel",
									description: "The channel to remove.",
									type: ApplicationCommandOptionType.Channel,
									required: true
								}
							]
						},
						{
							name: HighlightSubcommand.Clear,
							description: "Clear all channel scoping for your highlights.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: HighlightSubcommandGroup.UserBlacklist,
					description: "Manage your highlight user blacklist.",
					type: ApplicationCommandOptionType.SubcommandGroup,
					options: [
						{
							name: HighlightSubcommand.Add,
							description: "Blacklist a user from triggering your highlights.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "user",
									description: "The user to add.",
									type: ApplicationCommandOptionType.User,
									required: true
								}
							]
						},
						{
							name: HighlightSubcommand.Remove,
							description: "Remove a user from your highlight blacklist.",
							type: ApplicationCommandOptionType.Subcommand,
							options: [
								{
									name: "user",
									description: "The user to remove.",
									type: ApplicationCommandOptionType.User,
									required: true
								}
							]
						},
						{
							name: HighlightSubcommand.Clear,
							description: "Clear all users from your highlight blacklist.",
							type: ApplicationCommandOptionType.Subcommand
						}
					]
				},
				{
					name: HighlightSubcommand.List,
					description: "List your current highlight patterns and scoping.",
					type: ApplicationCommandOptionType.Subcommand
				},
				{
					name: HighlightSubcommand.Clear,
					description: "Clear all highlight patterns and scoping.",
					type: ApplicationCommandOptionType.Subcommand
				}
			]
		};
	}

	public async interactionRun(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const subcommandGroup = interaction.options.getSubcommandGroup();
		const subcommand = interaction.options.getSubcommand() as HighlightSubcommand;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!subcommandGroup) {
			switch (subcommand) {
				case HighlightSubcommand.List:
					return Highlights._listHighlights(interaction);
				case HighlightSubcommand.Clear:
					return Highlights._clearAllHighlights(interaction);
				default: {
					return {
						error: "Unknown subcommand."
					};
				}
			}
		}

		if (subcommandGroup === HighlightSubcommandGroup.Pattern) {
			switch (subcommand) {
				case HighlightSubcommand.Add:
					return Highlights._addPattern(interaction);
				case HighlightSubcommand.Remove:
					return Highlights._removePattern(interaction);
				case HighlightSubcommand.Clear:
					return Highlights._clearPatterns(interaction);
				default: {
					return {
						error: "Unknown subcommand."
					};
				}
			}
		}

		if (subcommandGroup === HighlightSubcommandGroup.ChannelScoping) {
			switch (subcommand) {
				case HighlightSubcommand.Add:
					return Highlights._addChannelScoping(interaction);
				case HighlightSubcommand.Remove:
					return Highlights._removeChannelScoping(interaction);
				case HighlightSubcommand.Clear:
					return Highlights._clearChannelScoping(interaction);
				default: {
					return {
						error: "Unknown subcommand."
					};
				}
			}
		}

		if (subcommandGroup === HighlightSubcommandGroup.UserBlacklist) {
			switch (subcommand) {
				case HighlightSubcommand.Add:
					return Highlights._addUserBlacklist(interaction);
				case HighlightSubcommand.Remove:
					return Highlights._removeUserBlacklist(interaction);
				case HighlightSubcommand.Clear:
					return Highlights._clearUserBlacklist(interaction);
				default: {
					return {
						error: "Unknown subcommand."
					};
				}
			}
		}

		return {
			error: "Unknown subcommand."
		};
	}

	private static async _addPattern(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const [config, patternCount] = await prisma.$transaction([
			prisma.highlightConfig.upsert({
				where: { id: interaction.guild.id },
				create: { id: interaction.guild.id },
				update: {}
			}),
			prisma.highlightPattern.count({
				where: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			})
		]);

		if (patternCount >= config.max_patterns) {
			return {
				error: `You have reached the maximum number of highlight patterns (${config.max_patterns}).`
			};
		}

		const pattern = interaction.options.getString("pattern", true);
		const isSafePattern = safe(pattern);

		if (!isSafePattern) {
			return {
				error: "The provided pattern has been flagged as unsafe or it exceeds the repetition limit (`25`)."
			};
		}

		try {
			await prisma.highlight.upsert({
				where: {
					user_id_guild_id: {
						user_id: interaction.user.id,
						guild_id: interaction.guild.id
					}
				},
				update: {
					patterns: {
						create: { pattern }
					}
				},
				create: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id,
					patterns: {
						create: { pattern }
					}
				}
			});
		} catch {
			return {
				error: `Failed to add pattern. It may already exist in your highlight patterns.`
			};
		}

		return { content: `Successfully added \`${pattern}\` to your highlights.` };
	}

	private static async _removePattern(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const pattern = interaction.options.getString("pattern", true);

		try {
			await prisma.highlightPattern.delete({
				where: {
					user_id_guild_id_pattern: {
						user_id: interaction.user.id,
						guild_id: interaction.guild.id,
						pattern
					}
				}
			});
		} catch {
			return {
				error: `Failed to remove pattern. It may not exist in your highlight patterns.`
			};
		}

		return { content: `Successfully removed \`${pattern}\` from your highlights.` };
	}

	private static async _clearPatterns(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const { count } = await prisma.highlightPattern.deleteMany({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guild.id
			}
		});

		if (count === 0) {
			return {
				content: `You have no highlight patterns to clear.`
			};
		}

		return { content: `Successfully cleared \`${count}\` ${inflect(count, "highlight pattern")}.` };
	}

	private static async _addChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getInteger("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		try {
			await prisma.highlight.upsert({
				where: {
					user_id_guild_id: {
						user_id: interaction.user.id,
						guild_id: interaction.guild.id
					}
				},
				update: {
					channel_scoping: {
						create: {
							channel_id: channel.id,
							type: scopeType
						}
					}
				},
				create: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id,
					channel_scoping: {
						create: {
							channel_id: channel.id,
							type: scopeType
						}
					}
				}
			});
		} catch {
			return {
				content: `Failed to ${stringifiedType} ${channel}. Please check whether the channel is already in the scope.`,
				temporary: true
			};
		}

		return { content: `Successfully ${stringifiedType}d ${channel} for your highlights.` };
	}

	private static async _removeChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true);

		try {
			await prisma.highlightChannelScoping.delete({
				where: {
					user_id_guild_id_channel_id: {
						user_id: interaction.user.id,
						guild_id: interaction.guild.id,
						channel_id: channel.id
					}
				}
			});
		} catch {
			return {
				content: `Failed to remove ${channel} from your highlight scoping. It may not exist in your highlight scoping.`
			};
		}

		return { content: `Successfully removed ${channel} from your highlight scoping.` };
	}

	private static async _clearChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const { count } = await prisma.highlightChannelScoping.deleteMany({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guild.id
			}
		});

		if (count === 0) {
			return {
				content: `You have no highlight channel scoping to clear.`
			};
		}

		return { content: `Successfully cleared \`${count}\` ${inflect(count, "highlight channel scoping")}.` };
	}

	private static async _addUserBlacklist(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const user = interaction.options.getUser("user", true);

		if (user.id === interaction.user.id) {
			return {
				error: `You cannot blacklist yourself.`
			};
		}

		try {
			await prisma.highlight.upsert({
				where: {
					user_id_guild_id: {
						user_id: interaction.user.id,
						guild_id: interaction.guild.id
					}
				},
				update: {
					user_blacklist: {
						create: {
							target_id: user.id
						}
					}
				},
				create: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id,
					user_blacklist: {
						create: {
							target_id: user.id
						}
					}
				}
			});
		} catch {
			return {
				error: `Failed to blacklist ${user}. They may already be blacklisted.`
			};
		}

		return { content: `Successfully blacklisted ${user} from triggering your highlights.` };
	}

	private static async _removeUserBlacklist(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const user = interaction.options.getUser("user", true);

		try {
			await prisma.highlightUserBlacklist.delete({
				where: {
					user_id_guild_id_target_id: {
						user_id: interaction.user.id,
						guild_id: interaction.guild.id,
						target_id: user.id
					}
				}
			});
		} catch {
			return {
				error: `Failed to remove ${user} from your highlight blacklist. They may not be blacklisted.`
			};
		}

		return { content: `Successfully removed ${user} from your highlight blacklist.` };
	}

	private static async _clearUserBlacklist(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const { count } = await prisma.highlightUserBlacklist.deleteMany({
			where: {
				user_id: interaction.user.id,
				guild_id: interaction.guild.id
			}
		});

		if (count === 0) {
			return {
				content: `You have no highlight user blacklist to clear.`
			};
		}

		return { content: `Successfully cleared \`${count}\` ${inflect(count, "highlight user blacklist entry")}.` };
	}

	private static async _listHighlights(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const highlights = await prisma.highlight.findUnique({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			include: {
				patterns: true,
				channel_scoping: true,
				user_blacklist: true
			}
		});

		const patternCount = highlights?.patterns.length ?? 0;
		const patterns = highlights?.patterns.map(({ pattern }) => `\`${pattern}\``).join("\n") || "None";

		const [includedChannels, excludedChannels] = highlights?.channel_scoping.reduce<[string[], string[]]>(
			(acc, channel) => {
				const index = channel.type === 0 ? 0 : 1;
				acc[index].push(`<#${channel.channel_id}>`);
				return acc;
			},
			[[], []]
		) ?? [[], []];

		const embed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setAuthor({
				name: `Highlights for @${interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.addFields([
				{
					name: `Patterns (${patternCount})`,
					value: patterns
				},
				{
					name: `Included Channels (${includedChannels.length})`,
					value: includedChannels.length > 0 ? includedChannels.join("\n") : "None",
					inline: true
				},
				{
					name: `Excluded Channels (${excludedChannels.length})`,
					value: excludedChannels.length > 0 ? excludedChannels.join("\n") : "None",
					inline: true
				}
			])
			.setTimestamp();

		return { embeds: [embed] };
	}

	private static async _clearAllHighlights(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		try {
			const [patterns] = await prisma.$transaction([
				prisma.highlightPattern.deleteMany({
					where: {
						user_id: interaction.user.id,
						guild_id: interaction.guildId
					}
				}),
				prisma.highlightChannelScoping.deleteMany({
					where: {
						user_id: interaction.user.id,
						guild_id: interaction.guildId
					}
				}),
				prisma.highlight.delete({
					where: {
						user_id_guild_id: {
							user_id: interaction.user.id,
							guild_id: interaction.guildId
						}
					}
				})
			]);

			return {
				content: `Successfully erased \`${patterns.count}\` ${inflect(patterns.count, "highlight")}.`
			};
		} catch {
			return {
				content: `Failed to erase highlights. You may not have any highlights set up.`
			};
		}
	}
}

const HighlightSubcommandGroup = {
	Pattern: "pattern",
	ChannelScoping: "channel-scoping",
	UserBlacklist: "user-blacklist"
} as const;

type HighlightSubcommandGroup = (typeof HighlightSubcommandGroup)[keyof typeof HighlightSubcommandGroup];

const HighlightSubcommand = {
	Add: "add",
	Remove: "remove",
	Clear: "clear",
	List: "list"
} as const;

type HighlightSubcommand = (typeof HighlightSubcommand)[keyof typeof HighlightSubcommand];
