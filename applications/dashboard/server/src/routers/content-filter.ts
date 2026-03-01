import * as z from 'zod'
import type { RawChannelScoping } from '@repo/config'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder } from '../errors'
import { snowflake } from '../schemas/common'
import { ContentFilterConfigUpdateSchema, ChannelScopingUpdateSchema } from '../schemas/content-filter'
import { getGuildConfig, updateGuildConfig } from '../utils/config'

export const contentFilterRouter = router({
    getConfig: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.content_filter
        }),

    updateConfig: guildProcedure
        .input(z.object({ guildId: snowflake, data: ContentFilterConfigUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [updated, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                content_filter: { ...config.content_filter, ...input.data },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return updated!.content_filter
        }),

    getChannelScoping: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.content_filter.channel_scoping
        }),

    setChannelScope: guildProcedure
        .input(z.object({ guildId: snowflake, channelId: snowflake, data: ChannelScopingUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => {
                const scoping = config.content_filter.channel_scoping
                const entry: RawChannelScoping = { channel_id: input.channelId, type: input.data.type }
                const idx = scoping.findIndex((s: RawChannelScoping) => s.channel_id === input.channelId)
                const next = idx >= 0
                    ? scoping.map((s: RawChannelScoping, i: number) => (i === idx ? entry : s))
                    : [...scoping, entry]
                return {
                    ...config,
                    content_filter: { ...config.content_filter, channel_scoping: next },
                }
            })
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),

    removeChannelScope: guildProcedure
        .input(z.object({ guildId: snowflake, channelId: snowflake }))
        .mutation(async ({ ctx, input }) => {
            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                content_filter: {
                    ...config.content_filter,
                    channel_scoping: config.content_filter.channel_scoping.filter(
                        (s: RawChannelScoping) => s.channel_id !== input.channelId,
                    ),
                },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),
})

export type ContentFilterRouter = typeof contentFilterRouter
