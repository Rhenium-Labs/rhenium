/**
 * Represents a cache entry with its data and expiration time.
 *
 * @template T The type of the cached data.
 * @property {T} data The cached value.
 * @property {number} expiresAt The timestamp (in milliseconds) when the cache entry expires.
 *
 */
export type KVEntry<T> = {
	data: T;
	expiresAt: number;
};

/** A simple key-value store with TTL support. */
export default class KeyValueStore {
	/** Map of cache entries. */
	private static _entries = new Map<string, KVEntry<unknown>>();

	/**
	 * Get a cached value if it exists and hasn't expired.
	 *
	 * @param key The cache key.
	 * @returns The cached value or null if not found/expired.
	 */
	static get<T>(key: string): T | null {
		const entry = this._entries.get(key) as KVEntry<T> | undefined;
		if (!entry) return null;

		if (Date.now() > entry.expiresAt) {
			this._entries.delete(key);
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
		this._entries.set(key, {
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
		this._entries.delete(key);
	}

	/**
	 * Delete all entries with keys that start with the given prefix.
	 * Useful for invalidating related cache entries (e.g., all guild data).
	 *
	 * @param prefix The key prefix to match for deletion.
	 * @returns void
	 */
	static deleteByPrefix(prefix: string): void {
		for (const key of this._entries.keys()) {
			if (key.startsWith(prefix)) {
				this._entries.delete(key);
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

		for (const [key, entry] of this._entries.entries()) {
			if (now > entry.expiresAt) {
				this._entries.delete(key);
			}
		}
	}
}

/** Cache TTL constants in seconds. */
export const CACHE_TTL = {
	/** User's guild list - 5 minutes */
	USER_GUILDS: 5 * 60,
	/** Individual guild data - 5 minutes */
	GUILD_DATA: 5 * 60
} as const;

/** Cleanup expired entries every 5 minutes. */
setInterval(() => KeyValueStore.cleanup(), 5 * 60 * 1000);
