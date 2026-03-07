import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import { HighlightsConfigUpdateSchema } from '../services/schemas/highlights.schema'
import type { HighlightsService } from '../services/highlights.service'
import type { RouterFn, GuildProcedureBuilder, GuildWriteProcedureBuilder } from '../procedures'

export function createHighlightsController(
    router: RouterFn,
    guildProcedure: GuildProcedureBuilder,
    guildWriteProcedure: GuildWriteProcedureBuilder,
    service: HighlightsService,
) {
    return router({
        getConfig: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.getConfig(input.guildId)),

        updateConfig: guildWriteProcedure
            .input(z.object({ guildId: snowflake, data: HighlightsConfigUpdateSchema }))
            .mutation(async ({ input }) =>
                service.updateConfig(input.guildId, input.data),
            ),
    })
}
