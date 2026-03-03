interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

/**
 * Simple in-memory cache with TTL support.
 * Used to cache Discord API responses and prevent rate limiting.
 */
class MemoryCache {
	/** Map of cache keys to their entries. */
	private cache = new Map<string, CacheEntry<unknown>>();

	/**
	 * Get a cached value if it exists and hasn't expired.
	 */
	get<T>(key: string): T | null {
		const entry = this.cache.get(key) as CacheEntry<T> | undefined;

		if (!entry) return null;

		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return null;
		}

		return entry.data;
	}

	/**
	 * Set a value in the cache with a TTL in seconds.
	 */
	set<T>(key: string, data: T, ttlSeconds: number): void {
		this.cache.set(key, {
			data,
			expiresAt: Date.now() + ttlSeconds * 1000
		});
	}

	/**
	 * Delete a specific key from the cache.
	 */
	delete(key: string): void {
		this.cache.delete(key);
	}

	/**
	 * Delete all keys matching a prefix.
	 */
	deleteByPrefix(prefix: string): void {
		for (const key of this.cache.keys()) {
			if (key.startsWith(prefix)) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Clear expired entries (called periodically).
	 */
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiresAt) {
				this.cache.delete(key);
			}
		}
	}
}

export const cache = new MemoryCache();

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
	/** User's guild list - 5 minutes */
	USER_GUILDS: 5 * 60,
	/** Individual guild data - 10 minutes */
	GUILD_DATA: 10 * 60
} as const;

// Cleanup expired entries every 5 minutes
setInterval(
	() => {
		cache.cleanup();
	},
	5 * 60 * 1000
);
