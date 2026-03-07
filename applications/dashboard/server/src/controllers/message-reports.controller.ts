import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import { MessageReportsConfigUpdateSchema } from '../services/schemas/message-reports.schema'
import type { MessageReportsService } from '../services/message-reports.service'
import type { RouterFn, GuildProcedureBuilder, GuildWriteProcedureBuilder } from '../procedures'

export function createMessageReportsController(
    router: RouterFn,
    guildProcedure: GuildProcedureBuilder,
    guildWriteProcedure: GuildWriteProcedureBuilder,
    service: MessageReportsService,
) {
    return router({
        getConfig: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.getConfig(input.guildId)),

        updateConfig: guildWriteProcedure
            .input(z.object({ guildId: snowflake, data: MessageReportsConfigUpdateSchema }))
            .mutation(async ({ input }) =>
                service.updateConfig(input.guildId, input.data),
            ),

        getBlacklist: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.getBlacklist(input.guildId)),

        addToBlacklist: guildWriteProcedure
            .input(z.object({ guildId: snowflake, userId: snowflake }))
            .mutation(async ({ input }) =>
                service.addToBlacklist(input.guildId, input.userId),
            ),

        removeFromBlacklist: guildWriteProcedure
            .input(z.object({ guildId: snowflake, userId: snowflake }))
            .mutation(async ({ input }) =>
                service.removeFromBlacklist(input.guildId, input.userId),
            ),
    })
}
