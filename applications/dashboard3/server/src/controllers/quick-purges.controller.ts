import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import { QuickPurgesConfigUpdateSchema } from '../services/schemas/quick-purges.schema'
import { ChannelScopingUpdateSchema } from '../services/schemas/content-filter.schema'
import type { QuickPurgesService } from '../services/quick-purges.service'
import type { RouterFn, GuildProcedureBuilder, GuildWriteProcedureBuilder } from '../procedures'

export function createQuickPurgesController(
    router: RouterFn,
    guildProcedure: GuildProcedureBuilder,
    guildWriteProcedure: GuildWriteProcedureBuilder,
    service: QuickPurgesService,
) {
    return router({
        getConfig: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.getConfig(input.guildId)),

        updateConfig: guildWriteProcedure
            .input(z.object({ guildId: snowflake, data: QuickPurgesConfigUpdateSchema }))
            .mutation(async ({ input }) =>
                service.updateConfig(input.guildId, input.data),
            ),

        getChannelScoping: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.getChannelScoping(input.guildId)),

        setChannelScope: guildWriteProcedure
            .input(z.object({ guildId: snowflake, channelId: snowflake, data: ChannelScopingUpdateSchema }))
            .mutation(async ({ input }) =>
                service.setChannelScope(input.guildId, input.channelId, input.data.type),
            ),

        removeChannelScope: guildWriteProcedure
            .input(z.object({ guildId: snowflake, channelId: snowflake }))
            .mutation(async ({ input }) =>
                service.removeChannelScope(input.guildId, input.channelId),
            ),
    })
}
