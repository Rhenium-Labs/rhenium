interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

// What is going on with git.

export default class KeyV {
	/** Map of cache entries. */
	private static _cache = new Map<string, CacheEntry<unknown>>();

	/**
	 * Get a cached value if it exists and hasn't expired.
	 *
	 * @param key The cache key.
	 * @returns The cached value or null if not found/expired.
	 */
	static get<T>(key: string): T | null {
		const entry = this._cache.get(key) as CacheEntry<T> | undefined;
		if (!entry) return null;

		if (Date.now() > entry.expiresAt) {
			this._cache.delete(key);
			return null;
		}

		return entry.data;
	}

	/**
	 * Set a value in the cache with a TTL in seconds.
	 *
	 * @param key The cache key.
	 * @param data The value to cache.
	 * @param ttlSeconds Time to live in seconds.
	 * @returns void
	 */

	static set<T>(key: string, data: T, ttlSeconds: number): void {
		this._cache.set(key, {
			data,
			expiresAt: Date.now() + ttlSeconds * 1000
		});
	}

	/**
	 * Delete an entry from the cache.
	 *
	 * @param key The cache key to delete.
	 * @returns void
	 */
	static delete(key: string): void {
		this._cache.delete(key);
	}

	/**
	 * Delete all entries with keys that start with the given prefix.
	 * Useful for invalidating related cache entries (e.g., all guild data).
	 *
	 * @param prefix The key prefix to match for deletion.
	 * @returns void
	 */
	static deleteByPrefix(prefix: string): void {
		for (const key of this._cache.keys()) {
			if (key.startsWith(prefix)) {
				this._cache.delete(key);
			}
		}
	}

	/**
	 * Clear expired entries from the cache.
	 * Should be called periodically to prevent memory bloat.
	 * @returns void
	 */
	static cleanup(): void {
		const now = Date.now();

		for (const [key, entry] of this._cache.entries()) {
			if (now > entry.expiresAt) {
				this._cache.delete(key);
			}
		}
	}
}

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
	/** User's guild list - 5 minutes */
	USER_GUILDS: 5 * 60,
	/** Individual guild data - 10 minutes */
	GUILD_DATA: 10 * 60
} as const;

// Cleanup expired entries every 5 minutes.
setInterval(
	() => {
		KeyV.cleanup();
	},
	5 * 60 * 1000
);
