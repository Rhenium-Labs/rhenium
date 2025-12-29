export class RateLimiter {
	/**
	 * The maximum number of requests allowed per window.
	 */
	private readonly limit: number;
	/**
	 * The time window in milliseconds.
	 */
	private readonly window: number;
	/**
	 * The internal cache to track rate limit entries.
	 */
	private readonly cache = new Map<string, RateLimitEntry>();

	/**
	 * Create a new rate limiter.
	 *
	 * @param limit The maximum number of requests allowed per window.
	 * @param window The time window in milliseconds.
	 * @returns A new RateLimiter instance.
	 */
	public constructor(limit: number, window: number) {
		this.limit = limit;
		this.window = window;
	}

	/**
	 * Check if a key is rate limited and consume one request.
	 *
	 * @param key The unique identifier for the rate limit bucket.
	 * @returns The result of the rate limit check.
	 */
	public consume(key: string): RateLimitResult {
		const now = performance.now();
		const entry = this.cache.get(key);

		// If no entry or window has expired, start fresh.
		if (!entry || now - entry.windowStart >= this.window) {
			this.cache.set(key, { count: 1, windowStart: now });

			return {
				success: true,
				remaining: this.limit - 1,
				reset: now + this.window
			};
		}

		// Window still active.
		if (entry.count < this.limit) {
			entry.count++;

			return {
				success: true,
				remaining: this.limit - entry.count,
				reset: entry.windowStart + this.window
			};
		}

		// Rate limited.
		return {
			success: false,
			remaining: 0,
			reset: entry.windowStart + this.window
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
		const entry = this.cache.get(key);

		if (!entry || now - entry.windowStart >= this.window) {
			return {
				success: true,
				remaining: this.limit,
				reset: now + this.window
			};
		}

		return {
			success: entry.count < this.limit,
			remaining: Math.max(0, this.limit - entry.count),
			reset: entry.windowStart + this.window
		};
	}

	/**
	 * Reset the rate limit for a key.
	 *
	 * @param key The unique identifier for the rate limit bucket.
	 */
	public reset(key: string): void {
		this.cache.delete(key);
	}

	/**
	 * Clear all rate limit entries.
	 */
	public clear(): void {
		this.cache.clear();
	}

	/**
	 * Remove expired entries from the cache.
	 * Call this periodically to prevent memory leaks.
	 */
	public prune(): void {
		const now = performance.now();

		for (const [key, entry] of this.cache) {
			if (now - entry.windowStart >= this.window) {
				this.cache.delete(key);
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
