import app from './index'
import { env } from './src/utils/env'

Bun.serve({
    fetch: app.fetch,
    port: env.server.port,
})
console.log(`Server running at http://localhost:${env.server.port}`)
