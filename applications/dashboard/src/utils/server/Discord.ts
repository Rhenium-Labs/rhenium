import {
	PermissionFlagsBits,
	Routes,
	type APIUser,
	type RESTAPIPartialCurrentUserGuild,
	type RESTPostOAuth2AccessTokenResult
} from "discord-api-types/v10";
import { REST } from "@discordjs/rest";

import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from "$env/static/private";
import { DISCORD_API_BASE, DISCORD_OAUTH_SCOPES } from "$lib";
import { PUBLIC_BASE_URL } from "$env/static/public";

import KeyValueStore, { CACHE_TTL } from "./KVStore";

export default class DiscordUtils {
	/**
	 * Generates the Discord OAuth2 authorization URL.
	 *
	 * @param state A unique state string to prevent CSRF attacks. This should be stored in a cookie and verified on callback.
	 * @returns The full URL to redirect the user to for Discord OAuth2 authentication.
	 */

	static getOAuthURL(state: string): string {
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
	 * Exchanges an authorization code for access and refresh tokens.
	 *
	 * @param code The authorization code received from Discord after user authorization.
	 * @returns An object containing the access token, refresh token, and other related information.
	 */

	static async exchangeCode(code: string): Promise<RESTPostOAuth2AccessTokenResult> {
		const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				client_id: DISCORD_CLIENT_ID,
				client_secret: DISCORD_CLIENT_SECRET,
				grant_type: "authorization_code",
				redirect_uri: `${PUBLIC_BASE_URL}/api/auth/callback`
			})
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Failed to exchange OAuth2 code: ${error}.`);
		}

		return response.json();
	}

	/**
	 * Fetches the authenticated user's Discord profile using the access token.
	 *
	 * @param accessToken The OAuth2 access token for the user.
	 * @returns The user's Discord profile information.
	 */

	static async getUser(accessToken: string): Promise<APIUser> {
		const rest = new REST({ version: "10", authPrefix: "Bearer" }).setToken(accessToken);

		return rest.get(Routes.user()) as Promise<APIUser>;
	}

	/**
	 * Fetches the guilds the user is a member of, with caching to reduce API calls.
	 *
	 * @param options The options for the fetch.
	 *   - token: The user's OAuth2 access token.
	 *   - userId: The user's Discord ID (used for caching).
	 *   - forceRefresh: If true, bypasses the cache and fetches fresh data from Discord.
	 * @returns A list of guilds the user is a member of, filtered to those where they have admin privileges or are the owner.
	 */

	static async getUserGuilds(options: {
		token: string;
		userId: string;
		forceRefresh?: boolean;
	}): Promise<RESTAPIPartialCurrentUserGuild[]> {
		const kvKey = `user_guilds:${options.userId}`;

		if (!options.forceRefresh) {
			const cached = KeyValueStore.get<RESTAPIPartialCurrentUserGuild[]>(kvKey);
			if (cached) return cached;
		}

		const rest = new REST({ version: "10", authPrefix: "Bearer" }).setToken(options.token);

		// Only return guilds where the user is owner or has admin privileges.
		const guilds = (
			(await rest.get(Routes.userGuilds())) as RESTAPIPartialCurrentUserGuild[]
		).filter(guild => DiscordUtils.canManage(guild));

		KeyValueStore.set(kvKey, guilds, CACHE_TTL.USER_GUILDS);
		return guilds;
	}

	/**
	 * Generates the URL for a user's avatar, handling both custom and default avatars.
	 *
	 * @param userId The Discord user ID.
	 * @param hash The avatar hash from the user's profile (null if no custom avatar).
	 * @param size The desired size of the avatar image (default is 128). Must be a power of two between 16 and 4096.
	 * @returns The full URL to the user's avatar image.
	 */

	static generateAvatarURL(userId: string, hash: string | null, size: number = 128): string {
		if (hash) {
			const ext = hash.startsWith("a_") ? "gif" : "webp";
			return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=${size}`;
		}

		const defaultIndex = Number(BigInt(userId) >> 22n) % 6;
		return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
	}

	/**
	 * Generates the URL for a guild's icon, handling both custom and default icons.
	 *
	 * @param guildId The Discord guild ID.
	 * @param hash The icon hash from the guild's profile (null if no custom icon).
	 * @param size The desired size of the icon image (default is 128). Must be a power of two between 16 and 4096.
	 * @returns The full URL to the guild's icon image, or an empty string if no icon is set.
	 */

	static generateGuildIconURL(guildId: string, hash: string | null, size: number = 128): string {
		if (hash) {
			const ext = hash.startsWith("a_") ? "gif" : "webp";
			return `https://cdn.discordapp.com/icons/${guildId}/${hash}.${ext}?size=${size}`;
		}

		return "";
	}

	/**
	 * Checks if the user has permissions to manage the guild (administrator, manage guild, or owner).
	 *
	 * @param guild The guild object containing permissions and ownership information.
	 * @returns True if the user can manage the guild, false otherwise.
	 */

	static canManage(guild: RESTAPIPartialCurrentUserGuild): boolean {
		const permissions = BigInt(guild.permissions);

		return (
			guild.owner ||
			(permissions & PermissionFlagsBits.Administrator) !== 0n ||
			(permissions & PermissionFlagsBits.ManageGuild) !== 0n
		);
	}
}
