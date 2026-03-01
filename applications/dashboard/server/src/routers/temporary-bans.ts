import * as z from 'zod'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder, safeQuery } from '../errors'
import { snowflake } from '../schemas/common'

export const temporaryBansRouter = router({
    list: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [bans, queryErr] = await safeQuery(() =>
                ctx.db
                    .selectFrom('TemporaryBan')
                    .select(['target_id', 'expires_at'])
                    .where('guild_id', '=', input.guildId)
                    .execute(),
            )
            if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()

            return bans!
        }),
})

export type TemporaryBansRouter = typeof temporaryBansRouter
