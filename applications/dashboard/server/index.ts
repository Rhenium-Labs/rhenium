import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { trpcServer } from '@hono/trpc-server'
import { appRouter } from './src/trpc/router'
import { getDatabase } from './src/database'
import { jwt } from './src/utils/jwt'
import { env } from './src/utils/env'
import { authRoutes } from './src/routes/auth'
import type { Context } from './src/trpc/context'

const app = new Hono()

app.use(
    '*',
    cors({
        origin: env.server.corsOrigin,
        credentials: true,
    }),
)

app.route('/api/v1/auth', authRoutes)

app.use('/api/v1/trpc/*', async (c, next) => {
    return trpcServer({
        router: appRouter,
        createContext: async (): Promise<Context> => {
            const db = getDatabase()
            const authHeader = c.req.header('Authorization')
            const token = jwt.extractBearer(authHeader)

            let user: Context['user'] = null
            let isDeveloper = false

            if (token) {
                try {
                    const payload = await jwt.verify(token)
                    user = {
                        id: payload.sub,
                        username: payload.username,
                        avatar: payload.avatar,
                    }
                    isDeveloper = env.developers.includes(payload.sub)
                } catch {
                    user = null
                }
            }

            return { db, user, isDeveloper }
        },
    })(c, next)
})

export default app
export type { AppRouter } from './src/trpc/router'
