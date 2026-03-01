import * as z from 'zod'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder } from '../errors'
import { snowflake } from '../schemas/common'
import { BanRequestsConfigUpdateSchema } from '../schemas/ban-requests'
import { getGuildConfig, updateGuildConfig } from '../utils/config'

export const banRequestsRouter = router({
    getConfig: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.ban_requests
        }),

    updateConfig: guildProcedure
        .input(z.object({ guildId: snowflake, data: BanRequestsConfigUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [updated, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                ban_requests: { ...config.ban_requests, ...input.data },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return updated!.ban_requests
        }),
})

export type BanRequestsRouter = typeof banRequestsRouter
