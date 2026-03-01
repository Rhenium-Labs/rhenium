import * as z from 'zod'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder } from '../errors'
import { snowflake } from '../schemas/common'
import { MessageReportsConfigUpdateSchema } from '../schemas/message-reports'
import { getGuildConfig, updateGuildConfig } from '../utils/config'

export const messageReportsRouter = router({
    getConfig: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.message_reports
        }),

    updateConfig: guildProcedure
        .input(z.object({ guildId: snowflake, data: MessageReportsConfigUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [updated, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                message_reports: { ...config.message_reports, ...input.data },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return updated!.message_reports
        }),

    getBlacklist: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.message_reports.blacklisted_users
        }),

    addToBlacklist: guildProcedure
        .input(z.object({ guildId: snowflake, userId: snowflake }))
        .mutation(async ({ ctx, input }) => {
            const [updated, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => {
                const current = config.message_reports.blacklisted_users
                if (current.includes(input.userId)) return config
                return {
                    ...config,
                    message_reports: {
                        ...config.message_reports,
                        blacklisted_users: [...current, input.userId],
                    },
                }
            })
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return updated!.message_reports.blacklisted_users
        }),

    removeFromBlacklist: guildProcedure
        .input(z.object({ guildId: snowflake, userId: snowflake }))
        .mutation(async ({ ctx, input }) => {
            const [updated, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                message_reports: {
                    ...config.message_reports,
                    blacklisted_users: config.message_reports.blacklisted_users.filter((id: string) => id !== input.userId),
                },
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return updated!.message_reports.blacklisted_users
        }),
})

export type MessageReportsRouter = typeof messageReportsRouter
