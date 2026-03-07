import { t } from '../trpc'
import { DatabaseInstance } from '../database'
import { createProcedures } from '../procedures'

import { SessionRepository } from '../repositories/session.repository'
import { WhitelistRepository } from '../repositories/whitelist.repository'
import { GuildRepository } from '../repositories/guild.repository'
import { ContentFilterRepository } from '../repositories/content-filter.repository'
import { TemporaryBanRepository } from '../repositories/temporary-ban.repository'
import { DiscordRepository } from '../repositories/discord.repository'
import { GuildCacheRepository } from '../repositories/guild-cache.repository'
import { ChannelCacheRepository } from '../repositories/channel-cache.repository'
import { RoleCacheRepository } from '../repositories/role-cache.repository'

import { AuthService } from '../services/auth.service'
import { ConfigService } from '../services/config.service'
import { GuildService } from '../services/guild.service'
import { WhitelistService } from '../services/whitelist.service'
import { MessageReportsService } from '../services/message-reports.service'
import { BanRequestsService } from '../services/ban-requests.service'
import { ContentFilterService } from '../services/content-filter.service'
import { HighlightsService } from '../services/highlights.service'
import { QuickMutesService } from '../services/quick-mutes.service'
import { QuickPurgesService } from '../services/quick-purges.service'
import { LoggingService } from '../services/logging.service'
import { TemporaryBansService } from '../services/temporary-bans.service'
import { PermissionScopesService } from '../services/permission-scopes.service'
import { LogsService } from '../services/logs.service'
import { AuthorizationService } from '../services/authorization.service'
import { DiscordService } from '../services/discord.service'

import { createAuthTrpcController } from '../controllers/auth.trpc'
import { createGuildController } from '../controllers/guild.controller'
import { createWhitelistController } from '../controllers/whitelist.controller'
import { createMessageReportsController } from '../controllers/message-reports.controller'
import { createBanRequestsController } from '../controllers/ban-requests.controller'
import { createContentFilterController } from '../controllers/content-filter.controller'
import { createHighlightsController } from '../controllers/highlights.controller'
import { createQuickMutesController } from '../controllers/quick-mutes.controller'
import { createQuickPurgesController } from '../controllers/quick-purges.controller'
import { createLoggingController } from '../controllers/logging.controller'
import { createTemporaryBansController } from '../controllers/temporary-bans.controller'
import { createPermissionScopesController } from '../controllers/permission-scopes.controller'
import { createLogsController } from '../controllers/logs.controller'
import { createAuthRestController } from '../controllers/auth.controller'

function bootstrap() {
    const db = DatabaseInstance.getInstance()
    const router = t.router

    // Repositories
    const sessionRepo = new SessionRepository(db)
    const whitelistRepo = new WhitelistRepository(db)
    const guildRepo = new GuildRepository(db)
    const contentFilterRepo = new ContentFilterRepository(db)
    const tempBanRepo = new TemporaryBanRepository(db)
    const discordRepo = new DiscordRepository()
    const guildCacheRepo = new GuildCacheRepository(db)
    const channelCacheRepo = new ChannelCacheRepository(db)
    const roleCacheRepo = new RoleCacheRepository(db)

    // Services
    const configService = new ConfigService(guildRepo)
    const authService = new AuthService(sessionRepo, whitelistRepo, discordRepo)
    const authorizationService = new AuthorizationService(authService, whitelistRepo, discordRepo, guildCacheRepo)
    const discordService = new DiscordService(discordRepo, authorizationService)
    const guildService = new GuildService(configService, authorizationService, whitelistRepo, discordService, channelCacheRepo, roleCacheRepo)
    const whitelistService = new WhitelistService(whitelistRepo)
    const messageReportsService = new MessageReportsService(configService)
    const banRequestsService = new BanRequestsService(configService)
    const contentFilterService = new ContentFilterService(configService)
    const highlightsService = new HighlightsService(configService)
    const quickMutesService = new QuickMutesService(configService)
    const quickPurgesService = new QuickPurgesService(configService)
    const loggingService = new LoggingService(configService, discordRepo)
    const temporaryBansService = new TemporaryBansService(tempBanRepo)
    const permissionScopesService = new PermissionScopesService(configService)
    const logsService = new LogsService(contentFilterRepo)

    // Procedures
    const { publicProcedure, authedProcedure, guildProcedure, guildWriteProcedure } = createProcedures(authorizationService)

    // tRPC Router
    const appRouter = router({
        auth: createAuthTrpcController(router, authedProcedure, authService),
        guild: createGuildController(router, authedProcedure, guildProcedure, guildService),
        whitelist: createWhitelistController(router, authedProcedure, whitelistService),
        messageReports: createMessageReportsController(router, guildProcedure, guildWriteProcedure, messageReportsService),
        banRequests: createBanRequestsController(router, guildProcedure, guildWriteProcedure, banRequestsService),
        contentFilter: createContentFilterController(router, guildProcedure, guildWriteProcedure, contentFilterService),
        highlights: createHighlightsController(router, guildProcedure, guildWriteProcedure, highlightsService),
        quickMutes: createQuickMutesController(router, guildProcedure, guildWriteProcedure, quickMutesService),
        quickPurges: createQuickPurgesController(router, guildProcedure, guildWriteProcedure, quickPurgesService),
        logging: createLoggingController(router, guildProcedure, guildWriteProcedure, loggingService),
        temporaryBans: createTemporaryBansController(router, guildProcedure, guildWriteProcedure, temporaryBansService),
        permissionScopes: createPermissionScopesController(router, guildProcedure, guildWriteProcedure, permissionScopesService),
        logs: createLogsController(router, publicProcedure, logsService),
    })

    // REST controllers
    const authRestController = createAuthRestController(authService, authorizationService)

    return { appRouter, authRestController }
}

const container = bootstrap()

export const appRouter = container.appRouter
export const authRestController = container.authRestController
export type AppRouter = typeof appRouter
