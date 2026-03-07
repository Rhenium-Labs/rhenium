import type { MiddlewareHandler } from 'hono'

export function requestLogger(): MiddlewareHandler {
    return async (c, next) => {
		const start = Date.now()
		const method = c.req.method
		const path = c.req.path
		const timestamp = new Date(start).toISOString()

        await next()

		const duration = Date.now() - start
		const status = c.res.status
		// Example: [2026-03-04T12:34:56.789Z] [GET] /api/v1/trpc/guild.userGuilds 200 32ms
		console.log(`[${timestamp}] [${method}] ${path} ${status} ${duration}ms`)
    }
}
