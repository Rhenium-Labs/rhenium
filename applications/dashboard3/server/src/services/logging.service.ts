import type { LoggingWebhook } from '@repo/config'
import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'
import type { DiscordRepository } from '../repositories/discord.repository'
import type { LoggingWebhookCreate, LoggingWebhookUpdate } from './schemas/logging.schema'

export class LoggingService {
    constructor(
        private configService: ConfigService,
        private discordRepo: DiscordRepository,
    ) {}

    async list(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.logging_webhooks.map((w: LoggingWebhook) => ({
            id: w.id, channel_id: w.channel_id, events: w.events,
        }))
    }

    async get(guildId: string, webhookId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        const webhook = config!.logging_webhooks.find((w: LoggingWebhook) => w.id === webhookId)
        if (!webhook) throw ErrorBuilder.notFound('Logging webhook not found').build()
        return { id: webhook.id, channel_id: webhook.channel_id, events: webhook.events }
    }

    async create(guildId: string, data: LoggingWebhookCreate) {
        const [created, webhookErr] = await this.discordRepo.createWebhook(data.channel_id, 'Rhenium Logging')
        if (webhookErr) ErrorBuilder.webhookError('Failed to create Discord webhook').cause(webhookErr.cause).throw()

        const newWebhook: LoggingWebhook = {
            id: created!.id, url: created!.url, token: created!.token,
            channel_id: data.channel_id, events: data.events,
        }

        const [, updateErr] = await this.configService.update(guildId, (config) => ({
            ...config,
            logging_webhooks: [...config.logging_webhooks, newWebhook],
        }))
        if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()
        return { id: created!.id }
    }

    async update(guildId: string, webhookId: string, data: LoggingWebhookUpdate) {
        const [, err] = await this.configService.update(guildId, (config) => {
            const idx = config.logging_webhooks.findIndex((w: LoggingWebhook) => w.id === webhookId)
            if (idx < 0) ErrorBuilder.notFound('Logging webhook not found').throw()
            const updated = [...config.logging_webhooks]
            updated[idx] = { ...updated[idx]!, events: data.events }
            return { ...config, logging_webhooks: updated }
        })
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }

    async delete(guildId: string, webhookId: string) {
        const [config, configErr] = await this.configService.get(guildId)
        if (configErr) ErrorBuilder.fromAppError(configErr).throw()

        const webhook = config!.logging_webhooks.find((w: LoggingWebhook) => w.id === webhookId)
        if (!webhook) throw ErrorBuilder.notFound('Logging webhook not found').build()

        await this.discordRepo.deleteWebhook(webhook.id, webhook.token)

        const [, updateErr] = await this.configService.update(guildId, (cfg) => ({
            ...cfg,
            logging_webhooks: cfg.logging_webhooks.filter((w: LoggingWebhook) => w.id !== webhookId),
        }))
        if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()
        return { success: true }
    }
}
