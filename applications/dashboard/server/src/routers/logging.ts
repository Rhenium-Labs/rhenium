import * as z from 'zod'
import type { LoggingWebhook } from '@repo/config'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder } from '../errors'
import { snowflake } from '../schemas/common'
import { LoggingWebhookCreateSchema, LoggingWebhookUpdateSchema } from '../schemas/logging'
import { discordWebhook } from '../utils/webhook'
import { getGuildConfig, updateGuildConfig } from '../utils/config'
import { env } from '../utils/env'

export const loggingRouter = router({
    list: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.logging_webhooks.map((w: LoggingWebhook) => ({
                id: w.id,
                channel_id: w.channel_id,
                events: w.events,
            }))
        }),

    get: guildProcedure
        .input(z.object({ guildId: snowflake, webhookId: z.string() }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            const webhook = config!.logging_webhooks.find((w: LoggingWebhook) => w.id === input.webhookId)
            if (!webhook) return ErrorBuilder.notFound('Logging webhook not found').throw()

            return {
                id: webhook.id,
                channel_id: webhook.channel_id,
                events: webhook.events,
            }
        }),

    create: guildProcedure
        .input(z.object({ guildId: snowflake, data: LoggingWebhookCreateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [created, webhookErr] = await discordWebhook.create(
                input.data.channel_id,
                'Rhenium Logging',
                env.discord.botToken,
            )
            if (webhookErr) ErrorBuilder.webhookError('Failed to create Discord webhook').cause(webhookErr.cause).throw()

            const newWebhook: LoggingWebhook = {
                id: created!.id,
                url: created!.url,
                token: created!.token,
                channel_id: input.data.channel_id,
                events: input.data.events,
            }

            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                logging_webhooks: [...config.logging_webhooks, newWebhook],
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { id: created!.id }
        }),

    update: guildProcedure
        .input(z.object({ guildId: snowflake, webhookId: z.string(), data: LoggingWebhookUpdateSchema }))
        .mutation(async ({ ctx, input }) => {
            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => {
                const idx = config.logging_webhooks.findIndex((w: LoggingWebhook) => w.id === input.webhookId)
                if (idx < 0) ErrorBuilder.notFound('Logging webhook not found').throw()

                const updated = [...config.logging_webhooks]
                updated[idx] = { ...updated[idx]!, events: input.data.events }
                return { ...config, logging_webhooks: updated }
            })
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),

    delete: guildProcedure
        .input(z.object({ guildId: snowflake, webhookId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            const webhook = config!.logging_webhooks.find((w: LoggingWebhook) => w.id === input.webhookId)
            if (!webhook) return ErrorBuilder.notFound('Logging webhook not found').throw()

            await discordWebhook.delete(webhook.id, webhook.token)

            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (cfg) => ({
                ...cfg,
                logging_webhooks: cfg.logging_webhooks.filter((w: LoggingWebhook) => w.id !== input.webhookId),
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),
})

export type LoggingRouter = typeof loggingRouter
