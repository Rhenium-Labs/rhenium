import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import { LoggingWebhookCreateSchema, LoggingWebhookUpdateSchema } from '../services/schemas/logging.schema'
import type { LoggingService } from '../services/logging.service'
import type { RouterFn, GuildProcedureBuilder, GuildWriteProcedureBuilder } from '../procedures'

export function createLoggingController(
    router: RouterFn,
    guildProcedure: GuildProcedureBuilder,
    guildWriteProcedure: GuildWriteProcedureBuilder,
    service: LoggingService,
) {
    return router({
        list: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.list(input.guildId)),

        get: guildProcedure
            .input(z.object({ guildId: snowflake, webhookId: z.string() }))
            .query(async ({ input }) =>
                service.get(input.guildId, input.webhookId),
            ),

        create: guildWriteProcedure
            .input(z.object({ guildId: snowflake, data: LoggingWebhookCreateSchema }))
            .mutation(async ({ input }) =>
                service.create(input.guildId, input.data),
            ),

        update: guildWriteProcedure
            .input(z.object({ guildId: snowflake, webhookId: z.string(), data: LoggingWebhookUpdateSchema }))
            .mutation(async ({ input }) =>
                service.update(input.guildId, input.webhookId, input.data),
            ),

        delete: guildWriteProcedure
            .input(z.object({ guildId: snowflake, webhookId: z.string() }))
            .mutation(async ({ input }) =>
                service.delete(input.guildId, input.webhookId),
            ),
    })
}
