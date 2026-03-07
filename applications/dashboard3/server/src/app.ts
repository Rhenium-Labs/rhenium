import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { env } from './config/env'
import { API } from './constants'
import { requestLogger } from './middleware/logger'
import { createContext } from './security/context'
import { appRouter, authRestController } from './di/container'

const app = new Hono()

app.use('*', requestLogger())
app.use('*', cors({ origin: env.server.corsOrigin, credentials: true }))

app.get(`${API.PREFIX}/health`, (c) => c.json({ status: 'ok' }))

app.route(API.AUTH_PREFIX, authRestController)

app.use(`${API.TRPC_PREFIX}/*`, async (c, next) => {
    return trpcServer({
        router: appRouter,
        createContext: () => createContext(c),
    })(c, next)
})

export { app }
