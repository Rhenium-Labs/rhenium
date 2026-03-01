import { router } from './procedures'
import { authRouter } from '../routers/auth'
import { guildRouter } from '../routers/guild'
import { whitelistRouter } from '../routers/whitelist'
import { messageReportsRouter } from '../routers/message-reports'
import { banRequestsRouter } from '../routers/ban-requests'
import { contentFilterRouter } from '../routers/content-filter'
import { highlightsRouter } from '../routers/highlights'
import { quickMutesRouter } from '../routers/quick-mutes'
import { quickPurgesRouter } from '../routers/quick-purges'
import { loggingRouter } from '../routers/logging'
import { temporaryBansRouter } from '../routers/temporary-bans'
import { permissionScopesRouter } from '../routers/permission-scopes'
import { logsRouter } from '../routers/logs'

export const appRouter = router({
    auth: authRouter,
    guild: guildRouter,
    whitelist: whitelistRouter,
    messageReports: messageReportsRouter,
    banRequests: banRequestsRouter,
    contentFilter: contentFilterRouter,
    highlights: highlightsRouter,
    quickMutes: quickMutesRouter,
    quickPurges: quickPurgesRouter,
    logging: loggingRouter,
    temporaryBans: temporaryBansRouter,
    permissionScopes: permissionScopesRouter,
    logs: logsRouter,
})

export type AppRouter = typeof appRouter
