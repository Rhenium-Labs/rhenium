import * as z from 'zod'
import { router, publicProcedure } from '../trpc'
import { ErrorBuilder, safeQuery } from '../errors'
import { getDatabase } from '../database'

export const logsRouter = router({
    contentAlert: publicProcedure
        .input(z.object({ alertId: z.string().min(1) }))
        .query(async ({ input }) => {
            const db = getDatabase()

            const [alert, queryErr] = await safeQuery(() =>
                db
                    .selectFrom('ContentFilterAlert')
                    .select([
                        'id',
                        'guild_id',
                        'channel_id',
                        'offender_id',
                        'detectors',
                        'highest_score',
                        'mod_status',
                        'del_status',
                        'created_at',
                    ])
                    .where('id', '=', input.alertId)
                    .executeTakeFirst(),
            )
            if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()
            if (!alert) return ErrorBuilder.notFound('Alert not found').throw()

            const [logs, logsErr] = await safeQuery(() =>
                db
                    .selectFrom('ContentFilterLog')
                    .select(['content', 'created_at'])
                    .where('alert_id', '=', input.alertId)
                    .orderBy('created_at', 'asc')
                    .execute(),
            )
            if (logsErr) ErrorBuilder.internal().cause(logsErr.cause).throw()

            return {
                alert,
                logs: logs!,
            }
        }),

    contentLog: publicProcedure
        .input(z.object({ alertId: z.string().min(1) }))
        .query(async ({ input }) => {
            const db = getDatabase()

            const [logs, queryErr] = await safeQuery(() =>
                db
                    .selectFrom('ContentFilterLog')
                    .select(['content', 'created_at'])
                    .where('alert_id', '=', input.alertId)
                    .orderBy('created_at', 'asc')
                    .execute(),
            )
            if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()

            return logs!
        }),
})

export type LogsRouter = typeof logsRouter
