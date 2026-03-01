import * as z from 'zod'
import type { RawChannelScoping } from '@repo/config'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder } from '../errors'
import { snowflake } from '../schemas/common'
import { QuickMutesConfigUpdateSchema } from '../schemas/quick-mutes'
import { ChannelScopingUpdateSchema } from '../schemas/content-filter'
import { getGuildConfig, updateGuildConfig } from '../utils/config'

export const quickMutesRouter = router({
    getConfig: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.quick_mutes
        }),

    updateConfig: guildProcedure
        .input(z.object({ guildId: snowflake, data: QuickMutesConfigUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [updated, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                quick_mutes: { ...config.quick_mutes, ...input.data },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return updated!.quick_mutes
        }),

    getChannelScoping: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.quick_mutes.channel_scoping
        }),

    setChannelScope: guildProcedure
        .input(z.object({ guildId: snowflake, channelId: snowflake, data: ChannelScopingUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => {
                const scoping = config.quick_mutes.channel_scoping
                const entry: RawChannelScoping = { channel_id: input.channelId, type: input.data.type }
                const idx = scoping.findIndex((s: RawChannelScoping) => s.channel_id === input.channelId)
                const next = idx >= 0
                    ? scoping.map((s: RawChannelScoping, i: number) => (i === idx ? entry : s))
                    : [...scoping, entry]
                return {
                    ...config,
                    quick_mutes: { ...config.quick_mutes, channel_scoping: next },
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
                quick_mutes: {
                    ...config.quick_mutes,
                    channel_scoping: config.quick_mutes.channel_scoping.filter(
                        (s: RawChannelScoping) => s.channel_id !== input.channelId,
                    ),
                },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),
})

export type QuickMutesRouter = typeof quickMutesRouter
