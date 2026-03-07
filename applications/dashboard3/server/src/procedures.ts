import { t } from './trpc'
import { authMiddleware } from './security/auth.middleware'
import { createGuildGuard, createGuildWriteGuard } from './security/guild.guard'
import { standardRateLimit } from './middleware/rate-limit'
import type { AuthorizationService } from './services/authorization.service'

export function createProcedures(authorizationService: AuthorizationService) {
    const publicProcedure = t.procedure.use(standardRateLimit)
    const authedProcedure = publicProcedure.use(authMiddleware)
    const guildGuard = createGuildGuard()
    const guildWriteGuard = createGuildWriteGuard(authorizationService)
    const guildProcedure = authedProcedure.use(guildGuard)
    const guildWriteProcedure = guildProcedure.use(guildWriteGuard)

    return { publicProcedure, authedProcedure, guildProcedure, guildWriteProcedure }
}

export type RouterFn = typeof t.router

type ProcedureSet = ReturnType<typeof createProcedures>
export type PublicProcedureBuilder = ProcedureSet['publicProcedure']
export type AuthedProcedureBuilder = ProcedureSet['authedProcedure']
export type GuildProcedureBuilder = ProcedureSet['guildProcedure']
export type GuildWriteProcedureBuilder = ProcedureSet['guildWriteProcedure']
