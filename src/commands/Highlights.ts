import {
	type ApplicationCommandData,
	type ChatInputCommandInteraction,
	type Message,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	Colors,
	EmbedBuilder,
	InteractionContextType,
	MessageFlags,
	PermissionFlagsBits
} from "discord.js";

import safe from "safe-regex";

import { client, prisma } from "#root/index.js";
import { formatMessageContent } from "#utils/Messages.js";
import { channelInScope, inflect } from "#utils/index.js";

import type { ChannelScoping, InteractionReplyData } from "#utils/Types.js";

import Command from "#managers/commands/Command.js";
import RateLimiter from "#structures/RateLimiter.js";
import GuildConfig from "#managers/config/GuildConfig.js";
import ConfigManager from "#managers/config/ConfigManager.js";

/** Rate limiter for highlights. */
const ratelimiter = new RateLimiter(1, 15000);

/** Cache for compiled highlight regex patterns. */
const compiledRegexCache = new Map<string, RegExp>();

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
			defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
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
									required: true
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

	public async interactionRun(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const group = interaction.options.getSubcommandGroup();
		const subcommand = interaction.options.getSubcommand() as HighlightSubcommand;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Route to the appropriate handler based on group and subcommand.
		const routeKey = group ? `${group}:${subcommand}` : subcommand;

		const handlers: Record<string, () => Promise<InteractionReplyData>> = {
			// Top-level subcommands (no group)
			[HighlightSubcommand.List]: () => this._listHighlights(interaction),
			[HighlightSubcommand.Clear]: () => this._clearAllHighlights(interaction),

			// Pattern group
			[`${HighlightSubcommandGroup.Pattern}:${HighlightSubcommand.Add}`]: () =>
				this._addPattern(interaction, config),
			[`${HighlightSubcommandGroup.Pattern}:${HighlightSubcommand.Remove}`]: () =>
				this._removePattern(interaction),
			[`${HighlightSubcommandGroup.Pattern}:${HighlightSubcommand.Clear}`]: () =>
				this._clearPatterns(interaction),

			// Channel scoping group
			[`${HighlightSubcommandGroup.ChannelScoping}:${HighlightSubcommand.Add}`]: () =>
				this._addChannelScoping(interaction),
			[`${HighlightSubcommandGroup.ChannelScoping}:${HighlightSubcommand.Remove}`]: () =>
				this._removeChannelScoping(interaction),
			[`${HighlightSubcommandGroup.ChannelScoping}:${HighlightSubcommand.Clear}`]: () =>
				this._clearChannelScoping(interaction),

			// User blacklist group
			[`${HighlightSubcommandGroup.UserBlacklist}:${HighlightSubcommand.Add}`]: () =>
				this._addUserBlacklist(interaction),
			[`${HighlightSubcommandGroup.UserBlacklist}:${HighlightSubcommand.Remove}`]: () =>
				this._removeUserBlacklist(interaction),
			[`${HighlightSubcommandGroup.UserBlacklist}:${HighlightSubcommand.Clear}`]: () =>
				this._clearUserBlacklist(interaction)
		};

		const handler = handlers[routeKey];
		return handler ? handler() : { error: "Unknown subcommand." };
	}

	/** Highlights a message if it matches any user's highlight patterns. */
	public static async highlightMessage(message: Message<true>) {
		const guildId = message.guild.id;

		const config = await ConfigManager.getGuildConfig(guildId);
		const highlights = await prisma.highlight.findMany({
			where: { guild_id: guildId },
			select: {
				user_id: true,
				patterns: true,
				channel_scoping: true,
				user_blacklist: true
			}
		});

		// Return early if no highlights exist.
		if (highlights.length === 0) return;

		const messageContent = message.content;
		const messageAuthorId = message.author.id;

		for (const highlight of highlights) {
			// Ignore messages from the highlight owner.
			if (highlight.user_id === messageAuthorId) continue;

			// Check if the message author is blacklisted.
			if (highlight.user_blacklist.includes(messageAuthorId)) continue;

			// Check if the highlight user can view the channel.
			const highlightMember = await message.guild.members.fetch(highlight.user_id).catch(() => null);

			if (!highlightMember) continue;

			// Prevent people who had access to highlights but lost it from receiving highlights.
			if (!config.hasPermission(highlightMember, "UseHighlights")) continue;

			const canViewChannel = message.channel
				.permissionsFor(highlightMember)
				.has(PermissionFlagsBits.ViewChannel);

			if (!canViewChannel) continue;

			const channelScoping = highlight.channel_scoping.reduce<ChannelScoping>(
				(acc, channel) => {
					if (channel.type === 0) {
						acc.include_channels.push(channel.channel_id);
					} else {
						acc.exclude_channels.push(channel.channel_id);
					}

					return acc;
				},
				{
					include_channels: [],
					exclude_channels: []
				}
			);

			if (!channelInScope(message.channel, channelScoping)) {
				continue;
			}

			// Use cached compiled regex for pattern matching.
			const matchedPattern = highlight.patterns.find(pattern => {
				const regex = Highlights._getRegex(pattern);
				return regex.test(messageContent);
			});

			if (!matchedPattern) continue;

			// Prevent the same user from triggering the same highlight more than once in 15 seconds.
			if (!ratelimiter.limit(`${highlight.user_id}:${messageAuthorId}`).success) continue;

			const user = await client.users.fetch(highlight.user_id).catch(() => null);
			const formattedContent = await formatMessageContent(message.content, null, message.url);

			const embed = new EmbedBuilder()
				.setColor(Colors.Blue)
				.setAuthor({
					name: `Message from @${message.author.username}`,
					iconURL: message.author.displayAvatarURL()
				})
				.setFields([
					{
						name: `Highlight in ${message.channel}`,
						value: formattedContent
					},
					{
						name: "Pattern",
						value: `\`${matchedPattern}\``
					}
				])
				.setTimestamp();

			// Periodically clean up all caches.
			Highlights._cleanupRegexCache();

			return user?.send({ embeds: [embed] }).catch(() => null);
		}
	}

	private static _getRegex(pattern: string): RegExp {
		let regex = compiledRegexCache.get(pattern);

		if (!regex) {
			const isAsciiWord = /^[\w*]+$/.test(pattern);
			const regexPattern = pattern.replaceAll("*", "(\\n|\\r|.)*");
			const parsedPattern = isAsciiWord ? `\\b(${regexPattern})\\b` : `(${regexPattern})`;

			regex = new RegExp(parsedPattern, "i");
			compiledRegexCache.set(pattern, regex);
		}

		return regex;
	}

	private static _cleanupRegexCache(): void {
		if (compiledRegexCache.size > 1000) {
			const keys = [...compiledRegexCache.keys()].slice(0, compiledRegexCache.size - 500);
			keys.forEach(key => compiledRegexCache.delete(key));
		}
	}

	private async _addPattern(
		interaction: ChatInputCommandInteraction<"cached">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		const highlight = await this.prisma.highlight.upsert({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			create: {
				user_id: interaction.user.id,
				guild_id: interaction.guild.id
			},
			update: {}
		});

		if (highlight.patterns.length >= config.data.highlights.max_patterns) {
			return {
				error: `You have reached the maximum number of highlight patterns (${config.data.highlights.max_patterns}).`
			};
		}

		const pattern = interaction.options.getString("pattern", true);
		const isSafePattern = safe(pattern);

		if (!isSafePattern) {
			return {
				error: "The provided pattern has been flagged as unsafe or it exceeds the repetition limit (`25`)."
			};
		}

		if (highlight.patterns.includes(pattern)) {
			return {
				error: `The pattern \`${pattern}\` already exists in your highlight patterns.`
			};
		}

		await this.prisma.highlight.update({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			data: {
				patterns: {
					push: pattern
				}
			}
		});

		return { content: `Successfully added \`${pattern}\` to your highlights.` };
	}

	private async _removePattern(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const pattern = interaction.options.getString("pattern", true);
		const highlight = await this.prisma.highlight.findUnique({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			select: {
				patterns: true
			}
		});

		if (!highlight || !highlight.patterns.includes(pattern)) {
			return {
				error: `The pattern \`${pattern}\` does not exist in your highlight patterns.`
			};
		}

		await this.prisma.highlight.update({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			data: {
				patterns: {
					set: highlight.patterns.filter(p => p !== pattern)
				}
			}
		});

		return { content: `Successfully removed \`${pattern}\` from your highlights.` };
	}

	private async _clearPatterns(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const highlight = await this.prisma.highlight.findUnique({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			select: {
				patterns: true
			}
		});

		if (!highlight || highlight.patterns.length === 0) {
			return {
				content: `You have no highlight patterns to clear.`
			};
		}

		await this.prisma.highlight.update({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			data: {
				patterns: {
					set: []
				}
			}
		});

		return {
			content: `Successfully cleared \`${highlight.patterns.length}\` ${inflect(highlight.patterns.length, "highlight pattern")}.`
		};
	}

	private async _addChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getInteger("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		try {
			await this.prisma.highlight.upsert({
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

	private async _removeChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true);

		try {
			await this.prisma.highlightChannelScoping.delete({
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

	private async _clearChannelScoping(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const { count } = await this.prisma.highlightChannelScoping.deleteMany({
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

	private async _addUserBlacklist(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const user = interaction.options.getUser("user", true);

		if (user.id === interaction.user.id) {
			return {
				error: `You cannot blacklist yourself.`
			};
		}

		try {
			await this.prisma.highlight.upsert({
				where: {
					user_id_guild_id: {
						user_id: interaction.user.id,
						guild_id: interaction.guild.id
					}
				},
				update: {
					user_blacklist: {
						push: user.id
					}
				},
				create: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id,
					user_blacklist: [user.id]
				}
			});
		} catch {
			return {
				error: `Failed to blacklist ${user}. They may already be blacklisted.`
			};
		}

		return { content: `Successfully blacklisted ${user} from triggering your highlights.` };
	}

	private async _removeUserBlacklist(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const user = interaction.options.getUser("user", true);

		const highlight = await this.prisma.highlight.findUnique({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			select: {
				user_blacklist: true
			}
		});

		if (!highlight || !highlight.user_blacklist.includes(user.id)) {
			return {
				error: `${user} is not in your highlight blacklist.`
			};
		}

		const updatedBlacklist = highlight.user_blacklist.filter(u => u !== user.id);

		await this.prisma.highlight.update({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			data: {
				user_blacklist: updatedBlacklist
			}
		});

		return { content: `Successfully removed ${user} from your highlight blacklist.` };
	}

	private async _clearUserBlacklist(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const highlight = await this.prisma.highlight.findUnique({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			select: {
				user_blacklist: true
			}
		});

		if (!highlight || !highlight.user_blacklist.length) {
			return {
				content: `You have no highlight user blacklist to clear.`
			};
		}

		await this.prisma.highlight.update({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			data: {
				user_blacklist: []
			}
		});

		return {
			content: `Successfully cleared \`${highlight.user_blacklist.length}\` ${inflect(highlight.user_blacklist.length, "highlight user blacklist entry")}.`
		};
	}

	private async _listHighlights(interaction: ChatInputCommandInteraction<"cached">): Promise<InteractionReplyData> {
		const highlights = await this.prisma.highlight.findUnique({
			where: {
				user_id_guild_id: {
					user_id: interaction.user.id,
					guild_id: interaction.guild.id
				}
			},
			include: {
				channel_scoping: true
			}
		});

		const patternCount = highlights?.patterns.length ?? 0;
		const patterns = highlights?.patterns.map(pattern => `\`${pattern}\``).join("\n") || "None";
		const blacklistedUsers = highlights?.user_blacklist.map(id => `<@${id}>`).join("\n") || "None";

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
				},
				{
					name: `Blacklisted Users (${highlights?.user_blacklist.length})`,
					value: blacklistedUsers,
					inline: true
				}
			])
			.setTimestamp();

		return { embeds: [embed] };
	}

	private async _clearAllHighlights(
		interaction: ChatInputCommandInteraction<"cached">
	): Promise<InteractionReplyData> {
		const [patterns] = await this.prisma.$transaction([
			this.prisma.highlightChannelScoping.deleteMany({
				where: {
					user_id: interaction.user.id,
					guild_id: interaction.guildId
				}
			}),
			this.prisma.highlight.delete({
				where: {
					user_id_guild_id: {
						user_id: interaction.user.id,
						guild_id: interaction.guildId
					}
				}
			})
		]);

		if (patterns.count === 0) {
			return {
				content: `You have no highlights to clear.`
			};
		}

		return {
			content: `Successfully erased \`${patterns.count}\` ${inflect(patterns.count, "highlight")}.`
		};
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
