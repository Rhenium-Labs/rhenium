import {
	Colors,
	EmbedBuilder,
	Events,
	GuildBasedChannel,
	Message,
	MessageReplyOptions,
	PermissionFlagsBits
} from "discord.js";

import { reply } from "#utils/Messages.js";
import { RedisCache } from "#utils/Redis.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";
import { EventListener } from "#classes/EventListener.js";
import { client, prisma } from "#root/index.js";
import { captureException } from "@sentry/node";
import { MessageReplyData } from "#utils/Types.js";
import { formatMessageContent } from "#utils/Messages.js";
import { Command, CommandManager } from "#classes/Command.js";

import Args from "#classes/Args.js";
import Logger from "#utils/Logger.js";

/** Cooldown duration in milliseconds. */
const HIGHLIGHT_COOLDOWN_MS = 15_000;

/**
 * Map to track highlight cooldowns.
 * Key format: `${highlightUserId}:${messageAuthorId}`
 */
const highlightCooldowns = new Map<string, number>();

/**
 * Cache for compiled highlight regex patterns.
 * Key: pattern string
 */
const compiledRegexCache = new Map<string, RegExp>();

export default class MessageCreate extends EventListener {
	public constructor() {
		super(Events.MessageCreate);
	}

	public async onEmit(message: Message<true>) {
		// prettier-ignore
		return Promise.all([
			MessageCreate._highlightMessage(message), 
			MessageCreate._messageCommand(message)
		]);
	}

	private static async _highlightMessage(message: Message<true>) {
		const guildId = message.guild.id;
		const now = Date.now();

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
			// Prevent the same user from triggering the same highlight more than once in 15 seconds.
			const cooldownKey = `${highlight.user_id}:${messageAuthorId}`;
			const lastTriggered = highlightCooldowns.get(cooldownKey);

			if (lastTriggered && now - lastTriggered < HIGHLIGHT_COOLDOWN_MS) {
				continue;
			}

			// Ignore messages from the highlight owner.
			if (highlight.user_id === messageAuthorId) continue;

			// Check if the message author is blacklisted.
			if (highlight.user_blacklist.some(u => u.target_id === messageAuthorId)) {
				continue;
			}

			const canViewChannel = message.channel
				.permissionsFor(highlight.user_id)
				?.has(PermissionFlagsBits.ViewChannel);

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
			const matchedPattern = highlight.patterns.find(({ pattern }) => {
				const regex = getCompiledRegex(pattern);
				return regex.test(messageContent);
			});

			if (!matchedPattern) continue;

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
						value: `\`${matchedPattern.pattern}\``
					}
				])
				.setTimestamp();

			// Set cooldown before sending to prevent race conditions.
			highlightCooldowns.set(cooldownKey, Date.now());

			// Periodically clean up all caches.
			cleanupCaches();

			return user?.send({ embeds: [embed] }).catch(() => null);
		}
	}

	private static async _messageCommand(message: Message<true>) {
		const prefix = await this._getPrefix(message);

		if (!prefix) return;
		if (!(await MessageCreate._checkWhitelist(message))) return;

		const trimmedContent = message.content.slice(prefix.length).trim();
		const spaceIndex = trimmedContent.indexOf(" ");

		const commandName = spaceIndex === -1 ? trimmedContent : trimmedContent.slice(0, spaceIndex);
		const command = CommandManager.get(commandName);

		if (!command || !command.messageRun) return;

		const parameters = spaceIndex === -1 ? "" : trimmedContent.substring(spaceIndex + 1).trim();
		const args = command.getArgsClass(message, parameters);

		try {
			await MessageCreate._runCommand(message, command, args);
		} catch (error) {
			const sentryId = captureException(error, {
				user: {
					id: message.author.id,
					username: message.author.username
				},
				extra: {
					channelId: message.channel.id,
					guildId: message.guild.id,
					messageId: message.id,
					command: command.name,
					messageContent: message.content
				}
			});

			await reply(message, {
				content: `An error occurred while executing this command (\`${sentryId}\`).`
			});

			return Logger.error("Error handling message command:", error);
		}
	}

	private static async _runCommand(message: Message<true>, command: Command, args: Args) {
		const response: MessageReplyData | null = await command.messageRun!(message, args);

		// Manually handled response.
		if (response === null) return;

		const error = response.error;
		delete response.error;

		const defaultOptions: MessageReplyOptions = {
			allowedMentions: { parse: [] }
		};

		const replyOptions = error
			? {
					...response,
					embeds: [{ description: error, color: Colors.Red }, ...(response.embeds ?? [])]
				}
			: response;

		await reply(message, { ...defaultOptions, ...replyOptions });
	}

	private static async _getPrefix(message: Message<true>): Promise<string | null> {
		if (message.author.bot || message.webhookId) {
			return null;
		}

		const bot = await message.guild.members.fetchMe();
		const permissions = message.channel.permissionsFor(bot);

		if (!permissions.has(PermissionFlagsBits.SendMessages)) {
			return null;
		}

		return process.env.DEFAULT_PREFIX ?? ".";
	}

	private static async _checkWhitelist(message: Message<true>): Promise<boolean> {
		if (DEVELOPER_IDS.includes(message.author.id)) {
			return true;
		}

		const whitelisted = await RedisCache.guildIsWhitelisted(message.guild.id);

		if (!whitelisted) {
			await message.reply({
				content: "This guild is not whitelisted to use the bot."
			});
		}

		return whitelisted;
	}
}

type ChannelScoping = {
	include_channels: string[];
	exclude_channels: string[];
};

/**
 * Checks if a channel is within the specified scoping.
 * Included channels take precedence over excluded channels.
 *
 * @param channel The channel to check.
 * @param scoping The channel scoping configuration.
 * @returns Whether the channel is in scope.
 */

function channelInScope(channel: GuildBasedChannel, scoping: ChannelScoping): boolean {
	const channelId = channel.isThread() ? channel.parent?.id : channel.id;
	const threadId = channel.isThread() ? channel.id : null;
	const categoryId = channel.isThread() ? channel.parent?.parentId : channel.parentId;

	const relevantIds = [channelId, threadId, categoryId].filter((id): id is string => Boolean(id));

	// Check if included (or no include list exists).
	const hasInclusions = scoping.include_channels.length > 0;
	const isIncluded = !hasInclusions || relevantIds.some(id => scoping.include_channels.includes(id));

	if (!isIncluded) return false;

	// Even if included, check if it's excluded.
	const hasExclusions = scoping.exclude_channels.length > 0;
	const isExcluded = hasExclusions && relevantIds.some(id => scoping.exclude_channels.includes(id));

	return !isExcluded;
}

/**
 * Gets a compiled RegExp from the pattern, using caching to avoid recompilation.
 *
 * @param pattern The highlight pattern.
 * @returns The compiled RegExp.
 */
function getCompiledRegex(pattern: string): RegExp {
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

/**
 * Cleans up expired entries in the various caches.
 */
function cleanupCaches(): void {
	const now = Date.now();

	// Cleanup cooldowns.
	for (const [key, timestamp] of highlightCooldowns) {
		if (now - timestamp >= HIGHLIGHT_COOLDOWN_MS) {
			highlightCooldowns.delete(key);
		}
	}

	// Limit regex cache size to prevent unbounded growth.
	if (compiledRegexCache.size > 1000) {
		const entriesToDelete = compiledRegexCache.size - 500;
		const iterator = compiledRegexCache.keys();

		for (let i = 0; i < entriesToDelete; i++) {
			const key = iterator.next().value;
			if (key) compiledRegexCache.delete(key);
		}
	}
}
