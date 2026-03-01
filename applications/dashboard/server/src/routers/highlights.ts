import * as z from 'zod'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder } from '../errors'
import { snowflake } from '../schemas/common'
import { HighlightsConfigUpdateSchema } from '../schemas/highlights'
import { getGuildConfig, updateGuildConfig } from '../utils/config'

export const highlightsRouter = router({
    getConfig: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.highlights
        }),

    updateConfig: guildProcedure
        .input(z.object({ guildId: snowflake, data: HighlightsConfigUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [updated, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                highlights: { ...config.highlights, ...input.data },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return updated!.highlights
        }),
})

export type HighlightsRouter = typeof highlightsRouter
