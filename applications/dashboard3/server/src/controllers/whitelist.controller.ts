import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import type { WhitelistService } from '../services/whitelist.service'
import type { RouterFn, AuthedProcedureBuilder } from '../procedures'

export function createWhitelistController(router: RouterFn, authedProcedure: AuthedProcedureBuilder, service: WhitelistService) {
    return router({
        list: authedProcedure.query(async () => service.list()),

        add: authedProcedure
            .input(z.object({ guildId: snowflake }))
            .mutation(async ({ input }) => service.add(input.guildId)),

        remove: authedProcedure
            .input(z.object({ guildId: snowflake }))
            .mutation(async ({ input }) => service.remove(input.guildId)),
    })
}
