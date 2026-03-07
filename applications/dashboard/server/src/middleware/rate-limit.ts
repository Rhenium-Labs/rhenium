import { t } from '../trpc'
import { ErrorBuilder } from '../errors/builder'
import { RATE_LIMIT } from '../constants'
import type { AppContext } from '../security/context'

interface RateLimitEntry {
    count: number
    resetAt: number
}

const buckets = new Map<string, RateLimitEntry>()

setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(key)
    }
}, RATE_LIMIT.CLEANUP_INTERVAL_MS)

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now()
    const entry = buckets.get(key)

    if (!entry || entry.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs })
        return true
    }
    if (entry.count >= maxRequests) return false
    entry.count++
    return true
}

interface RateLimitOptions {
    maxRequests: number
    windowMs: number
    keyFn?: (ctx: AppContext) => string
}

export function createRateLimitMiddleware(opts: RateLimitOptions) {
    return t.middleware(async ({ ctx, next, path }) => {
        const key = opts.keyFn
            ? opts.keyFn(ctx)
            : ctx.user
                ? `user:${ctx.user.id}:${path}`
                : `anon:${path}`

        if (!checkRateLimit(key, opts.maxRequests, opts.windowMs)) {
            ErrorBuilder.rateLimited().throw()
        }
        return next({ ctx })
    })
}

export const standardRateLimit = createRateLimitMiddleware({
    maxRequests: RATE_LIMIT.STANDARD.MAX_REQUESTS,
    windowMs: RATE_LIMIT.STANDARD.WINDOW_MS,
})

export const strictRateLimit = createRateLimitMiddleware({
    maxRequests: RATE_LIMIT.STRICT.MAX_REQUESTS,
    windowMs: RATE_LIMIT.STRICT.WINDOW_MS,
})

export const publicRateLimit = createRateLimitMiddleware({
    maxRequests: RATE_LIMIT.PUBLIC.MAX_REQUESTS,
    windowMs: RATE_LIMIT.PUBLIC.WINDOW_MS,
    keyFn: () => 'public',
})
