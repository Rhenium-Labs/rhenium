import * as z from 'zod'
import { router, devProcedure } from '../trpc'
import { ErrorBuilder, safeQuery } from '../errors'
import { snowflake } from '../schemas/common'

export const whitelistRouter = router({
    list: devProcedure.query(async ({ ctx }) => {
        const [guilds, queryErr] = await safeQuery(() =>
            ctx.db
                .selectFrom('Whitelist')
                .select(['id', 'created_at'])
                .execute(),
        )
        if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()

        return guilds!
    }),

    add: devProcedure
        .input(z.object({ guildId: snowflake }))
        .mutation(async ({ ctx, input }) => {
            const [existing, checkErr] = await safeQuery(() =>
                ctx.db
                    .selectFrom('Whitelist')
                    .select('id')
                    .where('id', '=', input.guildId)
                    .executeTakeFirst(),
            )
            if (checkErr) ErrorBuilder.internal().cause(checkErr.cause).throw()
            if (existing) ErrorBuilder.conflict('Guild is already whitelisted').throw()

            const [, insertErr] = await safeQuery(() =>
                ctx.db
                    .insertInto('Whitelist')
                    .values({ id: input.guildId })
                    .execute(),
            )
            if (insertErr) ErrorBuilder.internal().cause(insertErr.cause).throw()

            return { id: input.guildId }
        }),

    remove: devProcedure
        .input(z.object({ guildId: snowflake }))
        .mutation(async ({ ctx, input }) => {
            const [result, deleteErr] = await safeQuery(() =>
                ctx.db
                    .deleteFrom('Whitelist')
                    .where('id', '=', input.guildId)
                    .executeTakeFirst(),
            )
            if (deleteErr) ErrorBuilder.internal().cause(deleteErr.cause).throw()
            if (!result!.numDeletedRows) ErrorBuilder.notFound('Guild not found in whitelist').throw()

            return { success: true }
        }),
})

export type WhitelistRouter = typeof whitelistRouter
