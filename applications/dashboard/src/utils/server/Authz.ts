import { createBotClient } from "./TRPC";
import KeyValueStore, { CACHE_TTL } from "./KVStore";

/**
 * Returns whether the given user is configured as a bot developer.
 * Results are cached briefly to reduce repeated tRPC calls.
 *
 * @param userId Discord user ID.
 * @returns True when the user is a bot developer.
 */
export async function isDeveloperUser(userId: string): Promise<boolean> {
	const cacheKey = `user_is_developer:${userId}`;
	const cached = KeyValueStore.get<boolean>(cacheKey);
	if (cached !== null) {
		return cached;
	}

	const trpc = createBotClient(userId, userId);
	const isDeveloper = await trpc.auth.isDeveloper.query().catch(() => false);

	KeyValueStore.set(cacheKey, isDeveloper, CACHE_TTL.USER_GUILDS);
	return isDeveloper;
}
