import { REST } from "@discordjs/rest";
import {
	type APIUser,
	type RESTAPIPartialCurrentUserGuild,
	type RESTPostOAuth2AccessTokenResult,
	PermissionFlagsBits,
	Routes
} from "discord-api-types/v10";

import { PUBLIC_BASE_URL } from "$env/static/public";
import { DISCORD_API_BASE, DISCORD_OAUTH_SCOPES } from "$lib/env";
import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from "$env/static/private";

import KeyV, { CACHE_TTL } from "$lib/server/KeyV";

/**
 * Creates a REST client for OAuth Bearer token requests.
 */
function createUserRest(accessToken: string): REST {
	return new REST({ version: "10", authPrefix: "Bearer" }).setToken(accessToken);
}

/**
 * Generates the Discord OAuth2 authorization URL.
 */
export function getOAuthUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: DISCORD_CLIENT_ID,
		redirect_uri: `${PUBLIC_BASE_URL}/api/auth/callback`,
		response_type: "code",
		scope: DISCORD_OAUTH_SCOPES.join(" "),
		state
	});

	return `https://discord.com/oauth2/authorize?${params}`;
}

/**
 * Exchanges an authorization code for access/refresh tokens.
 */
export async function exchangeCode(code: string): Promise<RESTPostOAuth2AccessTokenResult> {
	const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: DISCORD_CLIENT_ID,
			client_secret: DISCORD_CLIENT_SECRET,
			grant_type: "authorization_code",
			code,
			redirect_uri: `${PUBLIC_BASE_URL}/api/auth/callback`
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to exchange code: ${error}`);
	}

	return response.json();
}

/**
 * Fetches the current user's profile from Discord.
 * Uses @discordjs/rest for automatic rate limit handling.
 */
export async function fetchUser(accessToken: string): Promise<APIUser> {
	const rest = createUserRest(accessToken);
	return rest.get(Routes.user()) as Promise<APIUser>;
}

/**
 * Fetches the user's guilds from Discord (with caching).
 * Uses @discordjs/rest for automatic rate limit handling.
 * @param accessToken - OAuth access token
 * @param userId - User ID for cache key
 * @param forceRefresh - Skip cache and fetch fresh data
 */
export async function fetchUserGuilds(
	accessToken: string,
	userId: string,
	forceRefresh = false
): Promise<RESTAPIPartialCurrentUserGuild[]> {
	const cacheKey = `guilds:${userId}`;

	// Check cache first (unless force refresh)
	if (!forceRefresh) {
		const cached = KeyV.get<RESTAPIPartialCurrentUserGuild[]>(cacheKey);
		if (cached) return cached;
	}

	const rest = createUserRest(accessToken);
	const guilds = (await rest.get(Routes.userGuilds())) as RESTAPIPartialCurrentUserGuild[];

	// Cache the result
	KeyV.set(cacheKey, guilds, CACHE_TTL.USER_GUILDS);
	return guilds;
}

/**
 * Invalidate a user's guild cache (e.g., after logout).
 */
export function invalidateUserGuildsCache(userId: string): void {
	KeyV.delete(`guilds:${userId}`);
}

/**
 * Generate avatar URL for a Discord user.
 */
export function getAvatarUrl(userId: string, avatarHash: string | null, size = 128): string {
	if (avatarHash) {
		const ext = avatarHash.startsWith("a_") ? "gif" : "webp";
		return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
	}
	// Default avatar based on user ID
	const defaultIndex = Number(BigInt(userId) >> 22n) % 6;
	return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

/**
 * Generate icon URL for a Discord guild.
 */
export function getGuildIconUrl(guildId: string, iconHash: string | null, size = 128): string {
	if (iconHash) {
		const ext = iconHash.startsWith("a_") ? "gif" : "webp";
		return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
	}
	return "";
}

/**
 * Check if user has required permissions to manage a guild.
 * Required: ADMINISTRATOR OR MANAGE_GUILD OR owner
 */
export function canManageGuild(guild: RESTAPIPartialCurrentUserGuild): boolean {
	const permissions = BigInt(guild.permissions);

	return (
		guild.owner ||
		(permissions & PermissionFlagsBits.Administrator) !== 0n ||
		(permissions & PermissionFlagsBits.ManageGuild) !== 0n
	);
}
