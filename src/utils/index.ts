import {
	WebhookClient,
	type APIMessage,
	type Emoji,
	type GuildBasedChannel,
	type GuildMember,
	type Snowflake,
	type WebhookMessageCreateOptions
} from "discord.js";
import { CronJob, CronJobParams } from "cron";
import { captureException, cron } from "@sentry/node";

import ms, { type StringValue } from "ms";
import fs from "node:fs";
import YAML from "yaml";

import { client, kv, kysely } from "#root/index.js";
import { DISCORD_EMOJI_REGEX, UNICODE_EMOJI_REGEX } from "./Constants.js";

import type { ChannelScoping, RawChannelScoping, SimpleResult } from "./Types.js";
import Logger from "./Logger.js";
import { LoggingEvent } from "#database/Enums.js";
import GuildConfig from "#config/GuildConfig.js";

/**
 * Checks a guild's whitelist status.
 *
 * @param guildId The ID of the guild to check.
 * @return True if the guild is whitelisted, false otherwise.
 */

export async function getWhitelistStatus(guildId: Snowflake): Promise<boolean> {
	const cacheKey = `whitelists:${guildId}`;
	const cached = kv.get(cacheKey) as { status: boolean } | undefined;

	if (cached !== undefined) return cached.status;

	const whitelistEntry = await kysely
		.selectFrom("Whitelist")
		.selectAll()
		.where("id", "=", guildId)
		.executeTakeFirst();

	const isWhitelisted = whitelistEntry !== undefined;

	await kv.put(cacheKey, { status: isWhitelisted });
	return isWhitelisted;
}

/**
 * Reads a YAML file from the given path and returns the parsed content.
 *
 * @param path The path to the YAML file.
 * @returns The parsed content of the YAML file.
 */
export function readYamlFile<T>(path: string): T {
	const content = fs.readFileSync(path, "utf-8");
	return YAML.parse(content) as T;
}

/**
 * Starts a Sentry-instrumented cron job.
 *
 * @param options Options for the cron job.
 * @returns void
 */
export function startCronJob(options: CronJobOptions): void {
	const { monitorSlug, cronTime, onTick } = options;

	const instrumentedCronJob = cron.instrumentCron(CronJob, monitorSlug);

	instrumentedCronJob
		.from({
			cronTime,
			timeZone: "GMT",
			onTick: async () => {
				Logger.custom(monitorSlug, "Running cron job...", { color: "Blue" });
				await onTick();
				Logger.custom(monitorSlug, "Successfully ran cron job.", { color: "Green" });
			}
		})
		.start();

	Logger.custom(monitorSlug, `Cron job started: ${cronTime}`, { color: "Orange" });
}

/**
 * Returns the singular or plural form of a word based on the count.
 *
 * @param count The number to base the inflection on.
 * @param singular The singular form of the word.
 * @param plural The plural form of the word. Defaults to singular + "s".
 * @returns The appropriate singular or plural form based on the count.
 */
export function inflect(count: number, singular: string, plural = `${singular}s`): string {
	return count === 1 ? singular : plural;
}

/**
 * Truncates a string to a maximum length, appending an ellipsis and remaining character count.
 *
 * @param str The string to truncate.
 * @param maxLength The maximum length of the truncated string.
 *
 * @returns The truncated string with an ellipsis and remaining character count if truncated.
 */
export function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;

	const croppedStr = str.slice(0, maxLength - 23);
	return `${croppedStr}…(${str.length - croppedStr.length} more characters)`;
}

/**
 *  Crops a string to a maximum number of lines, appending an indicator if lines were removed.
 *
 * @param str The string to crop.
 * @param maxLines The maximum number of lines to retain.
 *
 * @returns The cropped string with an indicator if lines were removed.
 */
export function cropLines(str: string, maxLines: number): string {
	const lines = str.split("\n");
	if (lines.length <= maxLines) return str;

	const diff = lines.length - maxLines + 1;
	return [...lines.slice(0, maxLines - 1), `(${diff} more ${inflect(diff, "line")})`].join("\n");
}

/**
 * Capitalize the first letter of a string.
 *
 * @param str The string to capitalize
 * @returns The capitalized string
 */

export function capitalize(str: string): string {
	if (str.length === 0) return str;
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Formats a user ID as a mention with the ID in parentheses. */
export function userMentionWithId(id: Snowflake): `<@${Snowflake}> (\`${Snowflake}\`)` {
	return `<@${id}> (\`${id}\`)`;
}

/** Delays execution for the specified number of milliseconds. */
export function sleep(duration: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, duration));
}

/** Parses a duration string into milliseconds. */
export function parseDurationString(str: string | null): number | null {
	if (!str) return null;

	const numericValue = Number(str);
	if (!isNaN(numericValue)) return numericValue * 1000;

	return ms(str as StringValue) ?? null;
}

/**
 * Validates that a duration falls within optional minimum and maximum bounds.
 *
 * @param data The duration data to validate.
 * @returns The result of the validation.
 */
export function validateDuration(data: {
	duration: number;
	minimum?: string;
	maximum?: string;
}): SimpleResult {
	const { duration, minimum, maximum } = data;

	const minMs = minimum ? ms(minimum as StringValue) : undefined;
	const maxMs = maximum ? ms(maximum as StringValue) : undefined;

	if (minMs && duration < minMs) {
		return { ok: false, message: `Duration must be at least ${minimum}.` };
	}

	if (maxMs && duration > maxMs) {
		return { ok: false, message: `Duration must not exceed ${maximum}.` };
	}

	return { ok: true };
}

/**
 * Checks if the executor has higher role hierarchy than the target.
 *
 * @param executor The member executing the action.
 * @param target The member being acted upon.
 *
 * @returns True if the executor has higher role hierarchy, false otherwise.
 */
export function hierarchyCheck(executor: GuildMember, target: GuildMember): boolean {
	if (executor.guild.ownerId === executor.id) return true;
	if (target.guild.ownerId === target.id) return false;

	return executor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

/**
 * Upload data to Hastebin and return the URL.
 *
 * @param data The data to upload.
 * @param ext The file extension for the uploaded data.
 *
 * @returns The Hastebin URL or null if the upload failed.
 */
export async function hastebin(data: unknown, ext = "js"): Promise<string | null> {
	const body = typeof data === "object" ? JSON.stringify(data, null, 2) : String(data);

	const response = await fetch("https://hst.sh/documents", { method: "POST", body });
	if (!response.ok) return null;

	const { key } = (await response.json()) as { key: string };
	return `https://hst.sh/${key}.${ext}`;
}

/**
 * Parses raw channel scoping data into the structured format.
 *
 * @param scoping The raw channel scoping data.
 * @returns The structured channel scoping configuration.
 */

export function parseChannelScoping(scoping: RawChannelScoping[]): ChannelScoping {
	return scoping.reduce<ChannelScoping>(
		(acc, item) => {
			if (item.type === 0) {
				acc.include_channels.push(item.channel_id);
			} else if (item.type === 1) {
				acc.exclude_channels.push(item.channel_id);
			}
			return acc;
		},
		{ include_channels: [], exclude_channels: [] }
	);
}

/**
 * Checks if a channel is within the defined scoping.
 *
 * @param channel The channel to check.
 * @param scoping The scoping configuration.
 * @returns True if the channel is within scope, false otherwise.
 */

export function channelInScope(channel: GuildBasedChannel, scoping: ChannelScoping): boolean {
	const channelData: ChannelScopingParams = {
		categoryId: channel.parentId,
		channelId: channel.id,
		threadId: null
	};

	if (channel.isThread() && channel.parent) {
		channelData.channelId = channel.parent.id;
		channelData.threadId = channel.id;
		channelData.categoryId = channel.parent.parentId;
	}

	if (!scoping.include_channels.length && !scoping.exclude_channels.length) {
		return true;
	}

	if (scoping.include_channels.length) {
		return channelIsIncludedInScope(channelData, scoping);
	}

	return !channelIsExcludedFromScope(channelData, scoping);
}

/** Helper function to determine if a channel is included in scope. */
function channelIsIncludedInScope(
	channelData: ChannelScopingParams,
	scoping: ChannelScoping
): boolean {
	const { channelId, threadId, categoryId } = channelData;

	return (
		!scoping.include_channels.length ||
		scoping.include_channels.includes(channelId) ||
		(threadId !== null && scoping.include_channels.includes(threadId)) ||
		(categoryId !== null && scoping.include_channels.includes(categoryId))
	);
}

/** Helper function to determine if a channel is excluded from scope. */
function channelIsExcludedFromScope(
	channelData: ChannelScopingParams,
	scoping: ChannelScoping
): boolean {
	const { channelId, threadId, categoryId } = channelData;

	return (
		scoping.exclude_channels.includes(channelId) ||
		(threadId !== null && scoping.exclude_channels.includes(threadId)) ||
		(categoryId !== null && scoping.exclude_channels.includes(categoryId))
	);
}

/**
 * Extracts the identifier from an emoji object.
 *
 * @param emoji A partial emoji object containing optional `id` and `name` properties.
 * @returns The emoji's ID if available, otherwise its name, or `null` if neither exists.
 */
export function getEmojiIdentifier(
	emoji: Partial<Pick<Emoji, "id" | "name">>
): Snowflake | string | null {
	return emoji.id ?? emoji.name ?? null;
}

/**
 * Validates an emoji string and returns its parsed representation.
 *
 * Supports both unicode emojis and custom Discord emojis. For custom emojis,
 * validates that the emoji exists within the specified guild.
 *
 * @param emoji The emoji string to validate (unicode character or Discord emoji format).
 * @param guildId The guild ID to check custom emoji membership against.
 * @returns A validated emoji object, or `null` if validation fails.
 */
export async function validateEmoji(
	emoji: string,
	guildId: Snowflake
): Promise<ValidatedEmoji | null> {
	const unicodeMatch = emoji.match(UNICODE_EMOJI_REGEX);

	if (unicodeMatch) {
		return { name: unicodeMatch[0] };
	}

	const customMatch = DISCORD_EMOJI_REGEX.exec(emoji);

	if (!customMatch?.groups) {
		return null;
	}

	const { id, name } = customMatch.groups;

	const emojis = await fetchGuildEmojis(guildId);

	if (!emojis) {
		return null;
	}

	const existsInGuild = emojis.some(e => e.id === id);
	return existsInGuild ? { id, name } : null;
}

/**
 * Fetches all emojis from a guild.
 *
 * @param guildId - The ID of the guild to fetch emojis from.
 * @returns An array of emoji objects, or `null` if the guild doesn't exist or fetching fails.
 */
export async function fetchGuildEmojis(guildId: Snowflake): Promise<Emoji[] | null> {
	const guild = await client.guilds.fetch(guildId).catch(() => null);

	if (!guild) {
		return null;
	}

	const emojis = await guild.emojis.fetch().catch(() => null);
	return emojis ? [...emojis.values()] : null;
}

/**
 * Retrieves the name of an emoji.
 *
 * For unicode emojis, returns the emoji character itself.
 * For custom emojis, looks up the name from the guild's emoji list.
 *
 * @param emoji - The emoji string or ID to look up.
 * @param guildId - The guild ID to search for custom emojis.
 * @returns The emoji's name, or `null` if not found.
 */
export async function getEmojiName(emoji: string, guildId: Snowflake): Promise<string | null> {
	const unicodeMatch = emoji.match(UNICODE_EMOJI_REGEX);

	if (unicodeMatch) {
		return unicodeMatch[0];
	}

	return getGuildEmojiName(emoji, guildId);
}

/**
 * Retrieves the name of a custom guild emoji by its ID.
 *
 * @param emojiId - The ID of the custom emoji to look up.
 * @param guildId - The guild ID to search in.
 * @returns The emoji's name, or `null` if not found.
 */
async function getGuildEmojiName(emojiId: string, guildId: Snowflake): Promise<string | null> {
	const emojis = await fetchGuildEmojis(guildId);

	if (!emojis) {
		return null;
	}

	const emoji = emojis.find(e => e.id === emojiId);
	return emoji?.name ?? null;
}

/**
 * Retrieves the display string for an emoji with proper Discord formatting.
 *
 * For unicode emojis, returns the emoji character itself.
 * For custom emojis, returns the full Discord format `<:name:id>` or `<a:name:id>` for animated.
 *
 * @param emoji - The emoji string or ID to look up.
 * @param guildId - The guild ID to search for custom emojis.
 * @returns The formatted emoji display string, or `null` if not found.
 */
export async function getEmojiDisplay(emoji: string, guildId: Snowflake): Promise<string | null> {
	const unicodeMatch = emoji.match(UNICODE_EMOJI_REGEX);

	if (unicodeMatch) {
		return unicodeMatch[0];
	}

	const emojis = await fetchGuildEmojis(guildId);

	if (!emojis) {
		return null;
	}

	const guildEmoji = emojis.find(e => e.id === emoji);

	if (!guildEmoji?.name) {
		return null;
	}

	const animated = guildEmoji.animated ? "a" : "";
	return `<${animated}:${guildEmoji.name}:${guildEmoji.id}>`;
}

/** Represents a validated emoji with optional ID (for custom emojis) and name. */
type ValidatedEmoji = {
	id?: Snowflake;
	name: string;
};

/** Parameters representing channel scoping details. */
type ChannelScopingParams = {
	channelId: string;
	threadId: string | null;
	categoryId: string | null;
};

/** Configuration options for starting cron jobs. */
type CronJobOptions = {
	monitorSlug: string;
	cronTime: CronJobParams["cronTime"];
	onTick: () => Promise<void> | void;
};

/**
 * Sends a log message to all webhooks configured for the specified event.
 *
 * @param data The logging options.
 * @returns The sent messages or null.
 */
export async function log(options: {
	event: LoggingEvent;
	config: GuildConfig;
	message: WebhookMessageCreateOptions;
}): Promise<APIMessage[] | null> {
	const { event, config, message } = options;

	const webhooks = config.data.logging_webhooks.filter(webhook =>
		webhook.events.includes(event)
	);

	if (!webhooks.length) return null;

	try {
		const webhookClients = webhooks.map(webhook => new WebhookClient({ url: webhook.url }));
		return Promise.all(
			webhookClients.map(client => client.send(message).finally(() => client.destroy()))
		);
	} catch (error) {
		const sentryId = captureException(error, {
			extra: { guildId: config.data.id, event, message }
		});

		Logger.traceable(
			sentryId,
			`Failed to log event "${event}" for guild "${config.data.id}".`
		);
		return null;
	}
}
