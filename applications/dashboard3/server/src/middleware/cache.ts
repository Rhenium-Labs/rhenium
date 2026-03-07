import { t } from '../trpc'
import { CACHE } from '../constants'

interface CacheEntry {
    result: unknown
    expiresAt: number
}

const store = new Map<string, CacheEntry>()

setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
        if (entry.expiresAt <= now) store.delete(key)
    }
}, CACHE.CLEANUP_INTERVAL_MS)

function hashInput(input: unknown): string {
    try {
        return JSON.stringify(input) ?? ''
    } catch {
        return ''
    }
}

export function createCacheMiddleware(ttlMs = CACHE.DEFAULT_TTL_MS) {
    return t.middleware(async ({ ctx, next, path, getRawInput }) => {
        const raw = await getRawInput()
        const userId = ctx.user ? ctx.user.id : 'anon'
        const key = `${userId}:${path}:${hashInput(raw)}`

        const cached = store.get(key)
        if (cached && cached.expiresAt > Date.now()) {
            return cached.result as Awaited<ReturnType<typeof next>>
        }

        const result = await next({ ctx })
        if (result.ok) {
            store.set(key, { result, expiresAt: Date.now() + ttlMs })
        }
        return result
    })
}

export function invalidateCache(pattern?: string): void {
    if (!pattern) {
        store.clear()
        return
    }
    for (const key of store.keys()) {
        if (key.includes(pattern)) store.delete(key)
    }
}
