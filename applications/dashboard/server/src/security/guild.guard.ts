import * as z from 'zod'
import { t } from '../trpc'
import { ErrorBuilder } from '../errors/builder'
import { safeParse } from '../errors/domain'
import type { AuthorizationService } from '../services/authorization.service'

const guildIdInput = z.object({ guildId: z.string() })

/**
 * Lightweight guard used for **all** guild-scoped procedures.
 *
 * It only checks that:
 * - the request is authenticated, and
 * - the requested guildId exists in the JWT's guild list.
 *
 * This is cheap (no Discord calls) and relies on the guild list
 * that was already validated at login time.
 */
export function createGuildGuard() {
    return t.middleware(async ({ ctx, getRawInput, next }) => {
        const raw = await getRawInput()
        const [parsed, parseErr] = safeParse(() => guildIdInput.parse(raw))
        if (parseErr) throw ErrorBuilder.validation('guildId is required').cause(parseErr.cause).build()

        if (!ctx.user) {
            throw ErrorBuilder.unauthorized().build()
        }

        const guildId = parsed!.guildId

        const allowed = ctx.user.guilds.some((g) => g.id === guildId)
        if (!allowed) {
            ErrorBuilder.forbidden('You do not have permission to manage this guild').throw()
        }

        return next({ ctx: { ...ctx, guildId } })
    })
}

/**
 * Stronger guard used only for **write** operations.
 *
 * It revalidates the user's permissions against Discord (via
 * AuthorizationService and the server-side cache). If the user
 * lost admin/manage permissions, this will start returning 403.
 */
export function createGuildWriteGuard(authorizationService: AuthorizationService) {
    return t.middleware(async ({ ctx, getRawInput, next }) => {
        if (!ctx.user) {
            throw ErrorBuilder.unauthorized().build()
        }

        const raw = await getRawInput()
        const [parsed, parseErr] = safeParse(() => guildIdInput.parse(raw))
        if (parseErr) ErrorBuilder.validation('guildId is required').cause(parseErr.cause).throw()

        const guildId = parsed!.guildId

        const canManage = await authorizationService.canManageGuild(ctx.user.id, guildId)

        if (!canManage) {
            ErrorBuilder.forbidden('You do not have permission to manage this guild').throw()
        }

        return next()
    })
}

