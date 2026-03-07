import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import { BanRequestsConfigUpdateSchema } from '../services/schemas/ban-requests.schema'
import type { BanRequestsService } from '../services/ban-requests.service'
import type { RouterFn, GuildProcedureBuilder, GuildWriteProcedureBuilder } from '../procedures'

export function createBanRequestsController(
    router: RouterFn,
    guildProcedure: GuildProcedureBuilder,
    guildWriteProcedure: GuildWriteProcedureBuilder,
    service: BanRequestsService,
) {
    return router({
        getConfig: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.getConfig(input.guildId)),

        updateConfig: guildWriteProcedure
            .input(z.object({ guildId: snowflake, data: BanRequestsConfigUpdateSchema }))
            .mutation(async ({ input }) =>
                service.updateConfig(input.guildId, input.data),
            ),
    })
}
