import * as z from 'zod'
import type { LogsService } from '../services/logs.service'
import type { RouterFn, PublicProcedureBuilder } from '../procedures'

export function createLogsController(router: RouterFn, publicProcedure: PublicProcedureBuilder, service: LogsService) {
    return router({
        contentAlert: publicProcedure
            .input(z.object({ alertId: z.string().min(1) }))
            .query(async ({ input }) => service.contentAlert(input.alertId)),

        contentLog: publicProcedure
            .input(z.object({ alertId: z.string().min(1) }))
            .query(async ({ input }) => service.contentLog(input.alertId)),
    })
}
