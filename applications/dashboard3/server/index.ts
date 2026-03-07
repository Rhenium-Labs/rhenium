import { app } from './src/app'
import { env } from './src/config/env'

Bun.serve({
    fetch: app.fetch,
    port: env.server.port,
})

console.log(`Server running at http://localhost:${env.server.port}`)

export { app }
export type { AppRouter } from './src/di/container'
