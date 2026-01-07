import { kv, prisma } from "#root/index.js";

export class KvCache {
	/**
	 * Check a guild's whitelist status.
	 *
	 * @param guildId The ID of the guild to check.
	 * @return True if the guild is whitelisted, false otherwise.
	 */

	public static async getWhitelistStatus(guildId: string): Promise<boolean> {
		const cacheKey = `whitelists:${guildId}`;
		const cached = kv.get(cacheKey) as { status: boolean } | undefined;

		if (cached !== undefined) return cached.status;

		const isWhitelisted = await prisma.whitelist
			.findUnique({ where: { id: guildId } })
			.then(Boolean)
			// If there's an error (e.g., database connection issue), treat as not whitelisted.
			.catch(() => false);

		await kv.put(cacheKey, { status: isWhitelisted });
		return isWhitelisted;
	}
}
