import {
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
import { jsonArrayFrom } from "kysely/helpers/postgres";

import safe from "safe-regex";

import { client, kysely } from "#root/index.js";
import { formatMessageContent } from "#utils/Messages.js";
import { ApplyOptions, Command } from "#rhenium";
import { channelInScope, hastebin, inflect, parseChannelScoping, truncate } from "#utils/index.js";

import type { InteractionReplyData } from "#utils/Types.js";

import RateLimiter from "#utils/RateLimiter.js";
import GuildConfig from "#root/lib/config/GuildConfig.js";
import ConfigManager from "#root/lib/config/ConfigManager.js";
import { Highlight } from "#kysely/Schema.js";

/** Rate limiter for highlights. */
const ratelimiter = new RateLimiter(1, 15000);

/** Cache for compiled highlight regex patterns with LRU tracking. */
const compiledRegexCache = new Map<string, RegExp>();
const regexCacheOrder: string[] = [];

/** Maximum size of the regex cache. */
const REGEX_CACHE_MAX_SIZE = 100;

@ApplyOptions<Command.Options>({
	name: "highlights",
	description: "Manage your message highlights."
})
export default class Highlights extends Command {
	public register(): Command.Data {
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
		interaction: Command.Interaction<"chatInput">,
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
		const config = await ConfigManager.get(guildId);

		if (!config.data.highlights.enabled) return;

		// This query is a nightmare, but so is prisma's performance.
		const highlights = await kysely
			.selectFrom("Highlight")
			.selectAll()
			.select(eb => [
				jsonArrayFrom(
					eb
						.selectFrom("HighlightChannelScoping")
						.select(["channel_id", "type"])
						.whereRef("HighlightChannelScoping.user_id", "=", "Highlight.user_id")
						.whereRef("HighlightChannelScoping.guild_id", "=", "Highlight.guild_id")
				).as("channel_scoping")
			])
			.where("guild_id", "=", guildId)
			.execute();

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

			const channelScoping = parseChannelScoping(highlight.channel_scoping);
			if (!channelInScope(message.channel, channelScoping)) continue;

			// Use cached compiled regex for pattern matching.
			const matchedPattern = highlight.patterns.find(pattern => {
				const regex = Highlights._getRegex(pattern);
				return regex.test(messageContent);
			});

			if (!matchedPattern) continue;

			// Prevent the same user from triggering the same highlight more than once in 15 seconds.
			if (!ratelimiter.limit(`${highlight.user_id}:${messageAuthorId}`).success) continue;

			const user = await client.users.fetch(highlight.user_id).catch(() => null);
			const formattedContent = await formatMessageContent({
				url: message.url,
				content: message.content,
				stickerId: null,
				createdAt: message.createdAt
			});

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

			return user?.send({ embeds: [embed] }).catch(() => null);
		}
	}

	private static _getRegex(pattern: string): RegExp {
		let regex = compiledRegexCache.get(pattern);

		if (regex) {
			// Move to end of order (most recently used)
			const idx = regexCacheOrder.indexOf(pattern);
			if (idx !== -1) {
				regexCacheOrder.splice(idx, 1);
			}
			regexCacheOrder.push(pattern);
			return regex;
		}

		const isAsciiWord = /^[\w*]+$/.test(pattern);
		const regexPattern = pattern.replaceAll("*", "(\\n|\\r|.)*");
		const parsedPattern = isAsciiWord ? `\\b(${regexPattern})\\b` : `(${regexPattern})`;

		regex = new RegExp(parsedPattern, "i");
		compiledRegexCache.set(pattern, regex);
		regexCacheOrder.push(pattern);

		// Enforce max size with LRU eviction
		Highlights._cleanupRegexCache();

		return regex;
	}

	private static _cleanupRegexCache(): void {
		while (compiledRegexCache.size > REGEX_CACHE_MAX_SIZE && regexCacheOrder.length > 0) {
			const oldest = regexCacheOrder.shift();

			if (oldest) {
				compiledRegexCache.delete(oldest);
			}
		}
	}

	private async _addPattern(
		interaction: Command.Interaction<"chatInput">,
		config: GuildConfig
	): Promise<InteractionReplyData> {
		let highlight = await kysely
			.selectFrom("Highlight")
			.selectAll()
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (!highlight) {
			// Create highlight entry if it doesn't exist.
			highlight = (await kysely
				.insertInto("Highlight")
				.values({
					user_id: interaction.user.id,
					guild_id: interaction.guild.id,
					patterns: [],
					user_blacklist: []
				})
				.returningAll()
				.executeTakeFirst()) as Highlight;
		}

		if ((highlight.patterns.length ?? 0) >= config.data.highlights.max_patterns) {
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

		const patterns = highlight.patterns.concat(pattern);

		await kysely
			.updateTable("Highlight")
			.set({ patterns })
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully added \`${pattern}\` to your highlights.` };
	}

	private async _removePattern(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const pattern = interaction.options.getString("pattern", true);
		const highlight = await kysely
			.selectFrom("Highlight")
			.select(["patterns"])
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (!highlight || !highlight.patterns.includes(pattern)) {
			return {
				error: `The pattern \`${pattern}\` does not exist in your highlight patterns.`
			};
		}

		const patterns = highlight.patterns.filter(p => p !== pattern);

		await kysely
			.updateTable("Highlight")
			.set({ patterns })
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		return { content: `Successfully removed \`${pattern}\` from your highlights.` };
	}

	private async _clearPatterns(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const highlight = await kysely
			.selectFrom("Highlight")
			.select(["patterns"])
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (!highlight || highlight.patterns.length === 0) {
			return {
				content: `You have no highlight patterns to clear.`
			};
		}

		await kysely
			.updateTable("Highlight")
			.set({ patterns: [] })
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		return {
			content: `Successfully cleared \`${highlight.patterns.length}\` ${inflect(highlight.patterns.length, "highlight pattern")}.`
		};
	}

	private async _addChannelScoping(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true);
		const scopeType = interaction.options.getInteger("type", true);
		const stringifiedType = scopeType === 0 ? "include" : "exclude";

		// Ensure highlight entry exists first or this will fail.
		let highlight = await kysely
			.selectFrom("Highlight")
			.selectAll()
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (!highlight) {
			// Create highlight entry if it doesn't exist.
			highlight = (await kysely
				.insertInto("Highlight")
				.values({
					user_id: interaction.user.id,
					guild_id: interaction.guild.id,
					patterns: [],
					user_blacklist: []
				})
				.returningAll()
				.executeTakeFirst()) as Highlight;
		}

		const scoping = await kysely
			.selectFrom("HighlightChannelScoping")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.where("channel_id", "=", channel.id)
			.executeTakeFirst();

		if (scoping) {
			return {
				error: `${channel} is already in your highlight scoping.`
			};
		}

		await kysely
			.insertInto("HighlightChannelScoping")
			.values({
				user_id: interaction.user.id,
				guild_id: interaction.guild.id,
				channel_id: channel.id,
				type: scopeType
			})
			.execute();

		return { content: `Successfully ${stringifiedType}d ${channel} for your highlights.` };
	}

	private async _removeChannelScoping(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const channel = interaction.options.getChannel("channel", true);
		const scoping = await kysely
			.selectFrom("HighlightChannelScoping")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.where("channel_id", "=", channel.id)
			.executeTakeFirst();

		if (!scoping) {
			return {
				error: `${channel} is not in your highlight scoping.`
			};
		}

		await kysely
			.deleteFrom("HighlightChannelScoping")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.where("channel_id", "=", channel.id)
			.execute();

		return { content: `Successfully removed ${channel} from your highlight scoping.` };
	}

	private async _clearChannelScoping(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const { numDeletedRows } = await kysely
			.deleteFrom("HighlightChannelScoping")
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (numDeletedRows === 0n) {
			return {
				content: `You have no highlight channel scoping to clear.`
			};
		}

		return {
			content: `Successfully cleared \`${numDeletedRows}\` ${inflect(Number(numDeletedRows), "highlight channel scoping")}.`
		};
	}

	private async _addUserBlacklist(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const user = interaction.options.getUser("user", true);

		if (user.id === interaction.user.id) {
			return {
				error: `You cannot blacklist yourself.`
			};
		}

		const highlight = await kysely
			.selectFrom("Highlight")
			.select(["user_blacklist"])
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (highlight && highlight.user_blacklist.includes(user.id)) {
			return {
				error: `${user} is already blacklisted from triggering your highlights.`
			};
		}

		const updatedBlacklist = highlight ? highlight.user_blacklist.concat(user.id) : [user.id];

		await kysely
			.insertInto("Highlight")
			.values({
				user_id: interaction.user.id,
				guild_id: interaction.guild.id,
				patterns: [],
				user_blacklist: updatedBlacklist
			})
			.onConflict(oc => oc.columns(["guild_id", "user_id"]).doUpdateSet({ user_blacklist: updatedBlacklist }))
			.execute();

		return { content: `Successfully blacklisted ${user} from triggering your highlights.` };
	}

	private async _removeUserBlacklist(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const user = interaction.options.getUser("user", true);

		const highlight = await kysely
			.selectFrom("Highlight")
			.select(["user_blacklist"])
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (!highlight || !highlight.user_blacklist.includes(user.id)) {
			return {
				error: `${user} is not in your highlight blacklist.`
			};
		}

		const updatedBlacklist = highlight.user_blacklist.filter(u => u !== user.id);

		await kysely
			.updateTable("Highlight")
			.set({ user_blacklist: updatedBlacklist })
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.execute();

		return { content: `Successfully removed ${user} from your highlight blacklist.` };
	}

	private async _clearUserBlacklist(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const highlight = await kysely
			.selectFrom("Highlight")
			.select(["user_blacklist"])
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.executeTakeFirst();

		if (!highlight || !highlight.user_blacklist.length) {
			return {
				content: `You have no highlight user blacklist to clear.`
			};
		}

		await kysely
			.updateTable("Highlight")
			.set({ user_blacklist: [] })
			.where("user_id", "=", interaction.user.id)
			.where("guild_id", "=", interaction.guild.id)
			.execute();

		return {
			content: `Successfully cleared \`${highlight.user_blacklist.length}\` ${inflect(highlight.user_blacklist.length, "highlight user blacklist entry")}.`
		};
	}

	private async _listHighlights(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const highlights = await kysely
			.selectFrom("Highlight")
			.select(eb => [
				jsonArrayFrom(
					eb
						.selectFrom("HighlightChannelScoping")
						.select(["channel_id", "type"])
						.whereRef("HighlightChannelScoping.user_id", "=", "Highlight.user_id")
						.whereRef("HighlightChannelScoping.guild_id", "=", "Highlight.guild_id")
				).as("channel_scoping")
			])
			.selectAll()
			.where("guild_id", "=", interaction.guild.id)
			.where("user_id", "=", interaction.user.id)
			.executeTakeFirst();

		if (!highlights) {
			return { content: `You have no highlights set up.` };
		}

		const patternsArr = highlights.patterns ?? [];
		const userBlacklist = highlights.user_blacklist ?? [];
		const channelScoping = highlights.channel_scoping ?? [];

		const patternCount = patternsArr.length;
		const rawPatterns = patternsArr.map(pattern => `\`${pattern}\``).join("\n") || "None";

		const blacklistedUsers = userBlacklist.map(id => `<@${id}>`).join("\n") || "None";

		const [includedChannels, excludedChannels] = channelScoping.reduce<[string[], string[]]>(
			(acc, channel) => {
				const index = channel.type === 0 ? 0 : 1;
				acc[index].push(`<#${channel.channel_id}>`);
				return acc;
			},
			[[], []]
		);

		let patterns: string;

		if (rawPatterns.length > 1024) {
			const hastebinUrl = (await hastebin(rawPatterns, "ts")) as string;
			patterns = truncate(`[View Full List](${hastebinUrl})`, 1024);
		} else {
			patterns = rawPatterns;
		}

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
					name: `Blacklisted Users (${userBlacklist.length})`,
					value: blacklistedUsers,
					inline: true
				}
			])
			.setTimestamp();

		return { embeds: [embed] };
	}

	private async _clearAllHighlights(interaction: Command.Interaction<"chatInput">): Promise<InteractionReplyData> {
		const { numDeletedRows } = await kysely.transaction().execute(async trx => {
			const scopingResult = await trx
				.deleteFrom("HighlightChannelScoping")
				.where("user_id", "=", interaction.user.id)
				.where("guild_id", "=", interaction.guildId)
				.executeTakeFirstOrThrow();

			await trx
				.deleteFrom("Highlight")
				.where("user_id", "=", interaction.user.id)
				.where("guild_id", "=", interaction.guildId)
				.execute();

			return scopingResult;
		});

		if (numDeletedRows === 0n) {
			return {
				content: `You have no highlights to clear.`
			};
		}

		return {
			content: `Successfully erased \`${numDeletedRows}\` ${inflect(Number(numDeletedRows), "highlight")}.`
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
