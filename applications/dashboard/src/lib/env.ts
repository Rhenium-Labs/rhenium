import {
	DISCORD_CLIENT_ID,
	DISCORD_CLIENT_SECRET,
	SESSION_SECRET,
	PG_URL
} from "$env/static/private";
import { PUBLIC_BASE_URL } from "$env/static/public";

/** Validated environment variables */
export const env = {
	DISCORD_CLIENT_ID,
	DISCORD_CLIENT_SECRET,
	PG_URL,
	PUBLIC_BASE_URL,
	SESSION_SECRET
} as const;

/** Discord OAuth2 constants */
export const DISCORD_API_BASE = "https://discord.com/api/v10";
export const DISCORD_OAUTH_SCOPES = ["identify", "guilds", "guilds.members.read"];

/** Session configuration */
export const SESSION_COOKIE_NAME = "rhenium_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Bot invite URL generator.
 * Permissions include: Ban Members, Moderate Members, Manage Messages,
 * Send Messages, View Audit Log, Read Message History, Embed Links, Attach Files
 */
export function getBotInviteUrl(guildId?: string): string {
	const permissions = "1099511893062"; // Calculated permission integer
	const scopes = "bot%20applications.commands";
	const baseUrl = `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&permissions=${permissions}&scope=${scopes}`;
	return guildId ? `${baseUrl}&guild_id=${guildId}&disable_guild_select=true` : baseUrl;
}
