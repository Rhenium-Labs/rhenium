import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import type { TemporaryBansService } from '../services/temporary-bans.service'
import type { RouterFn, GuildProcedureBuilder, GuildWriteProcedureBuilder } from '../procedures'

export function createTemporaryBansController(router: RouterFn, guildProcedure: GuildProcedureBuilder, guildWriteProcedure: GuildWriteProcedureBuilder, service: TemporaryBansService) {
    return router({
        list: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.list(input.guildId)),
    })
}
