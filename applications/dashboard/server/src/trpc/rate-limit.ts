import { ErrorBuilder } from '../errors'
import { t } from './init'

interface RateLimitEntry {
    count: number
    resetAt: number
}

const buckets = new Map<string, RateLimitEntry>()

const CLEANUP_INTERVAL_MS = 60_000
setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(key)
    }
}, CLEANUP_INTERVAL_MS)

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
    keyFn?: (ctx: { user: { id: string } | null }) => string
}

export function rateLimitMiddleware(opts: RateLimitOptions) {
    const { maxRequests, windowMs, keyFn } = opts

    return t.middleware(async ({ ctx, next, path }) => {
        const key = keyFn
            ? keyFn(ctx as { user: { id: string } | null })
            : ctx.user
                ? `user:${(ctx.user as { id: string }).id}:${path}`
                : `anon:${path}`

        if (!checkRateLimit(key, maxRequests, windowMs)) {
            ErrorBuilder.rateLimited().throw()
        }

        return next({ ctx })
    })
}

export const standardRateLimit = rateLimitMiddleware({
    maxRequests: 30,
    windowMs: 60_000,
})

export const strictRateLimit = rateLimitMiddleware({
    maxRequests: 5,
    windowMs: 60_000,
})

export const publicRateLimit = rateLimitMiddleware({
    maxRequests: 15,
    windowMs: 60_000,
    keyFn: () => 'public',
})
