import { GatewayIntentBits, Partials } from "discord.js";
import z from "zod";

/**
 * Gateway intents used by SS.
 * Among these intents are privileged ones. You'll need to enable `Server Members Intent` and `Message Content Intent`.
 *
 * @see https://discord.com/developers/docs/topics/gateway#gateway-intents
 */

export const CLIENT_INTENTS: readonly GatewayIntentBits[] = [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMembers,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent,
	GatewayIntentBits.GuildMessageReactions,
	GatewayIntentBits.GuildExpressions
];

/**
 * Partials used by SS.
 * These explicitly define which partial structures the client will receive.
 */

export const CLIENT_PARTIALS: readonly Partials[] = [
	Partials.Message,
	Partials.Channel,
	Partials.Reaction,
	Partials.GuildMember
];

/**
 * Regex patterns for matching Discord emojis.
 */

export const DISCORD_EMOJI_REGEX: Readonly<RegExp> = /<a?:(?<name>[a-zA-Z0-9_]+):(?<id>\d{17,19})>/;

/**
 * Regex pattern for matching Unicode emojis.
 */

export const UNICODE_EMOJI_REGEX: Readonly<RegExp> =
	/(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?))*)/gu;

/** Zod regex schema for validating cron expressions. */
// Format: "*/5 * * * *" (every 5 minutes) */

export const ZOD_CRON_REGEX = z
	.string()
	.regex(
		/^(@(annually|yearly|monthly|weekly|daily|hourly|reboot))|(@every (\d+(ns|us|µs|ms|s|m|h))+)|((((\d+,)+\d+|([\d*]+[/-]\d+)|\d+|\*) ?){5,7})$/gm
	);

/** Date format options for log entries. */
export const LOG_DATE_FORMAT: Intl.DateTimeFormatOptions = {
	month: "2-digit",
	day: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	timeZone: "GMT",
	hour12: false
};

/** Process events that will trigger a message store and exit the process. */
export const PROCESS_EXIT_EVENTS: readonly NodeJS.Signals[] = [
	"SIGHUP",
	"SIGINT",
	"SIGQUIT",
	"SIGILL",
	"SIGTRAP",
	"SIGABRT",
	"SIGBUS",
	"SIGFPE",
	"SIGUSR1",
	"SIGSEGV",
	"SIGUSR2",
	"SIGTERM"
];
