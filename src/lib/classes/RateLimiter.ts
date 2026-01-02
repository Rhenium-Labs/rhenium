export class RateLimiter {
	/**
	 * The maximum number of requests allowed per window.
	 */
	private readonly _limit: number;
	/**
	 * The time window in milliseconds.
	 */
	private readonly _window: number;
	/**
	 * The internal cache to track rate limit entries.
	 */
	private readonly _cache = new Map<string, RateLimitEntry>();

	/**
	 * Create a new rate limiter.
	 *
	 * @param limit The maximum number of requests allowed per window.
	 * @param window The time window in milliseconds.
	 * @returns A new RateLimiter instance.
	 */
	public constructor(limit: number, window: number) {
		this._limit = limit;
		this._window = window;
	}

	/**
	 * Check if a key is rate limited and consume one request.
	 *
	 * @param key The unique identifier for the rate limit bucket.
	 * @returns The result of the rate limit check.
	 */
	public limit(key: string): RateLimitResult {
		const now = performance.now();
		const entry = this._cache.get(key);

		// If no entry or window has expired, start fresh.
		if (!entry || now - entry.windowStart >= this._window) {
			this._cache.set(key, { count: 1, windowStart: now });

			return {
				success: true,
				remaining: this._limit - 1,
				reset: now + this._window
			};
		}

		// Window still active.
		if (entry.count < this._limit) {
			entry.count++;

			return {
				success: true,
				remaining: this._limit - entry.count,
				reset: entry.windowStart + this._window
			};
		}

		// Rate limited.
		return {
			success: false,
			remaining: 0,
			reset: entry.windowStart + this._window
		};
	}

	/**
	 * Check if a key is rate limited without consuming a request.
	 *
	 * @param key The unique identifier for the rate limit bucket.
	 * @returns The result of the rate limit check.
	 */
	public check(key: string): RateLimitResult {
		const now = performance.now();
		const entry = this._cache.get(key);

		if (!entry || now - entry.windowStart >= this._window) {
			return {
				success: true,
				remaining: this._limit,
				reset: now + this._window
			};
		}

		return {
			success: entry.count < this._limit,
			remaining: Math.max(0, this._limit - entry.count),
			reset: entry.windowStart + this._window
		};
	}

	/**
	 * Reset the rate limit for a key.
	 *
	 * @param key The unique identifier for the rate limit bucket.
	 */
	public reset(key: string): void {
		this._cache.delete(key);
	}

	/**
	 * Clear all rate limit entries.
	 */
	public clear(): void {
		this._cache.clear();
	}

	/**
	 * Remove expired entries from the cache.
	 * Call this periodically to prevent memory leaks.
	 */
	public prune(): void {
		const now = performance.now();

		for (const [key, entry] of this._cache) {
			if (now - entry.windowStart >= this._window) {
				this._cache.delete(key);
			}
		}
	}
}

type RateLimitResult = {
	success: boolean;
	remaining: number;
	reset: number;
};

type RateLimitEntry = {
	count: number;
	windowStart: number;
};
