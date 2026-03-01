import * as z from 'zod'
import { ErrorBuilder, safeQuery } from '../errors'
import { t } from './init'
import { authedProcedure } from './procedures'
import type { AuthUser } from './context'

const guildIdInput = z.object({
    guildId: z.string(),
})

const guildMiddleware = t.middleware(async ({ ctx, getRawInput, next }) => {
    const raw = await getRawInput()
    const parsed = guildIdInput.safeParse(raw)
    if (!parsed.success) {
        ErrorBuilder.validation('guildId is required').throw()
    }

    const guildId = parsed.data!.guildId

    const [whitelist, queryErr] = await safeQuery(() =>
        ctx.db
            .selectFrom('Whitelist')
            .select('id')
            .where('id', '=', guildId)
            .executeTakeFirst(),
    )
    if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()
    if (!whitelist) ErrorBuilder.notFound('Guild is not whitelisted').throw()

    return next({
        ctx: {
            ...ctx,
            guildId,
        },
    })
})

export const guildProcedure = authedProcedure.use(guildMiddleware)

export interface GuildContext {
    user: AuthUser
    guildId: string
    isDeveloper: boolean
}
