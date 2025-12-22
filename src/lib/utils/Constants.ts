import { GatewayIntentBits, Partials } from "discord.js";

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
	GatewayIntentBits.GuildMessageReactions
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
 * List of developer IDs.
 */

export const DEVELOPER_IDS: readonly string[] = [
	"746055295314165862", // @cobaltorum
	"389504173714046976" // @spidermat
];
