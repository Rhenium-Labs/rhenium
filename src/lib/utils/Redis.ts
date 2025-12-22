import { kv, prisma } from "#root/index.js";

export class RedisCache {
	/**
	 * Check a guild's whitelist status.
	 *
	 * @param guildId The ID of the guild to check.
	 * @return True if the guild is whitelisted, false otherwise.
	 */

	public static async guildIsWhitelisted(guildId: string): Promise<boolean> {
		const cacheKey = `whitelists:${guildId}`;
		const cached = await kv.get<boolean>(cacheKey);

		if (cached !== null) return cached;

		const isWhitelisted = await prisma.whitelist
			.findUnique({ where: { id: guildId } })
			.then(Boolean)
			// If there's an error (e.g., database connection issue), treat as not whitelisted.
			.catch(() => false);

		await kv.set(cacheKey, isWhitelisted);
		return isWhitelisted;
	}
}
