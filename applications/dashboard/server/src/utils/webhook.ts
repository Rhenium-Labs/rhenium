import { DISCORD } from '../constants'
import { ERROR_CODES } from '../constants/errors'
import { ok, err, type Result } from '../types/result'
import { safeFetch } from './safe'

export const discordWebhook = {
    isValidUrl(url: string): boolean {
        return DISCORD.WEBHOOK_URL_PATTERN.test(url)
    },

    async validate(url: string): Promise<Result<boolean>> {
        try {
            const response = await fetch(url)
            return ok(response.ok)
        } catch (cause) {
            return err({ code: ERROR_CODES.WEBHOOK_ERROR, message: 'Failed to validate webhook', cause })
        }
    },

    async create(
        channelId: string,
        name: string,
        botToken: string,
    ): Promise<Result<{ id: string; url: string; token: string }>> {
        const [data, fetchErr] = await safeFetch<{ id: string; token: string }>(
            `${DISCORD.API_BASE}/channels/${channelId}/webhooks`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bot ${botToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name }),
            },
        )

        if (fetchErr) {
            return err({ code: ERROR_CODES.WEBHOOK_ERROR, message: 'Failed to create webhook', cause: fetchErr })
        }

        return ok({
            id: data.id,
            url: `${DISCORD.API_BASE}/webhooks/${data.id}/${data.token}`,
            token: data.token,
        })
    },

    async delete(webhookId: string, token: string): Promise<Result<void>> {
        try {
            const response = await fetch(
                `${DISCORD.API_BASE}/webhooks/${webhookId}/${token}`,
                { method: 'DELETE' },
            )

            if (!response.ok) {
                return err({ code: ERROR_CODES.WEBHOOK_ERROR, message: `Failed to delete webhook: ${response.status}` })
            }

            return ok(undefined)
        } catch (cause) {
            return err({ code: ERROR_CODES.WEBHOOK_ERROR, message: 'Failed to delete webhook', cause })
        }
    },
} as const
