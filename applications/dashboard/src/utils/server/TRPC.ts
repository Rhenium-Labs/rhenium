import { BOT_TRPC_URL, TRPC_SECRET } from "$env/static/private";
import { createBotClient as _createBotClient } from "@repo/trpc/client";
import type { ChannelInfo, RoleInfo } from "@repo/trpc";

import KeyValueStore from "./KVStore";

/**
 * Creates a per-request tRPC client scoped to a specific guild and user.
 * Call this from server load functions or form actions.
 *
 * Usage:
 * ```ts
 * const trpc = createBotClient(guildId, userId);
 * const channels = await trpc.guild.channels.query({ guildId });
 * ```
 *
 * @param guildId The ID of the guild to scope the client to.
 * @param userId The ID of the user making the request, used for permission checks.
 * @returns A tRPC client instance that can be used to make API calls to the bot server.
 */
export function createBotClient(guildId: string, userId: string) {
	return _createBotClient(BOT_TRPC_URL, TRPC_SECRET, { guildId, userId });
}

/**
 * Safely loads roles for a guild, returning an empty array if the tRPC query fails.
 * The result of this function is cached for 1 minute.
 *
 * @param options The options for loading guild roles.
 *   - guildId: The ID of the guild to load roles for.
 *   - userId: The ID of the user making the request, used for permission checks.
 *   - forceRefresh: If true, bypasses the cache and forces a fresh query to the server.
 * @return An array of roles, or an empty array if the query fails.
 */

export async function queryGuildRoles({
	guildId,
	userId,
	forceRefresh = false
}: {
	guildId: string;
	userId: string;
	forceRefresh?: boolean;
}): Promise<RoleInfo[]> {
	const cacheKey = `guild_roles:${guildId}`;
	const trpc = createBotClient(guildId, userId);

	if (!forceRefresh) {
		const cached = KeyValueStore.get<RoleInfo[]>(cacheKey);
		if (cached) return cached;
	}

	const roles = await trpc.guild.roles.query({ guildId }).catch(() => []);
	KeyValueStore.set(cacheKey, roles, 60 * 1000);
	return roles;
}

/**
 * Safely loads channels for a guild, returning an empty array if the tRPC query fails.
 * The result of this function is cached for 1 minute.
 *
 * @param options The options for loading guild channels.
 *   - guildId: The ID of the guild to load channels for.
 *   - userId: The ID of the user making the request, used for permission checks.
 *   - forceRefresh: If true, bypasses the cache and forces a fresh query to the server.
 * @return An array of channels, or an empty array if the query fails.
 */

export async function queryGuildChannels({
	guildId,
	userId,
	forceRefresh = false
}: {
	guildId: string;
	userId: string;
	forceRefresh?: boolean;
}): Promise<ChannelInfo[]> {
	const cacheKey = `guild_channels:${guildId}`;
	const trpc = createBotClient(guildId, userId);

	if (!forceRefresh) {
		const cached = KeyValueStore.get<ChannelInfo[]>(cacheKey);
		if (cached) return cached;
	}

	const channels = await trpc.guild.channels.query({ guildId }).catch(() => []);
	KeyValueStore.set(cacheKey, channels, 60 * 1000);
	return channels;
}
