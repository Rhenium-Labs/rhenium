import { kv, kysely } from "#root/index.js";

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

		const whitelistEntry = await kysely
			.selectFrom("Whitelist")
			.selectAll()
			.where("id", "=", guildId)
			.executeTakeFirst();

		const isWhitelisted = whitelistEntry !== undefined;

		await kv.put(cacheKey, { status: isWhitelisted });
		return isWhitelisted;
	}
}
