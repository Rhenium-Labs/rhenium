import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import type { GuildService } from '../services/guild.service'
import type { RouterFn, AuthedProcedureBuilder, GuildProcedureBuilder } from '../procedures'

export function createGuildController(router: RouterFn, authedProcedure: AuthedProcedureBuilder, guildProcedure: GuildProcedureBuilder, service: GuildService) {
    return router({
        list: authedProcedure.query(async () => service.listWhitelisted()),

        userGuilds: authedProcedure.query(async ({ ctx }) =>
            service.userGuilds(ctx.user.id),
        ),

        get: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.get(input.guildId)),

        fullConfig: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.fullConfig(input.guildId)),

        resetConfig: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .mutation(async ({ input }) => service.resetConfig(input.guildId)),

        channels: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.channels(input.guildId)),

        roles: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.roles(input.guildId)),

        cachedChannels: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.cachedChannels(input.guildId)),

        cachedRoles: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.cachedRoles(input.guildId)),

        emojis: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.emojis(input.guildId)),
    })
}
