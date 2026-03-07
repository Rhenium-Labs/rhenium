import { DISCORD, ERROR_CODES } from '../constants'
import { env } from '../config/env'
import { ok, err, safeFetch, type Result } from '../errors/domain'
import type {
    DiscordUser,
    DiscordGuild,
    DiscordChannel,
    DiscordRole,
    DiscordEmoji,
    DiscordTokenResponse,
} from '../types/discord'

export class DiscordRepository {
    async exchangeCode(code: string): Promise<Result<DiscordTokenResponse>> {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: env.discord.redirectUri,
            client_id: env.discord.clientId,
            client_secret: env.discord.clientSecret,
        })
        return safeFetch(DISCORD.OAUTH2_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        })
    }

    async refreshToken(refreshToken: string): Promise<Result<DiscordTokenResponse>> {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: env.discord.clientId,
            client_secret: env.discord.clientSecret,
        })
        return safeFetch(DISCORD.OAUTH2_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        })
    }

    async getUser(accessToken: string): Promise<Result<DiscordUser>> {
        return safeFetch(`${DISCORD.API_BASE}/users/@me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
    }

    async getGuilds(accessToken: string): Promise<Result<DiscordGuild[]>> {
        return safeFetch(`${DISCORD.API_BASE}/users/@me/guilds`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
    }

    async getGuildChannels(guildId: string): Promise<Result<DiscordChannel[]>> {
        return safeFetch(`${DISCORD.API_BASE}/guilds/${guildId}/channels`, {
            headers: { Authorization: `Bot ${env.discord.botToken}` },
        })
    }

    async getGuildRoles(guildId: string): Promise<Result<DiscordRole[]>> {
        return safeFetch(`${DISCORD.API_BASE}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${env.discord.botToken}` },
        })
    }

    async getGuildEmojis(guildId: string): Promise<Result<DiscordEmoji[]>> {
        return safeFetch(`${DISCORD.API_BASE}/guilds/${guildId}/emojis`, {
            headers: { Authorization: `Bot ${env.discord.botToken}` },
        })
    }

    async revokeToken(token: string): Promise<Result<void>> {
        const body = new URLSearchParams({
            token,
            client_id: env.discord.clientId,
            client_secret: env.discord.clientSecret,
        })
        try {
            await fetch(DISCORD.OAUTH2_REVOKE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
            })
            return ok(undefined)
        } catch (cause) {
            return err({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Failed to revoke Discord token', cause })
        }
    }

    async createWebhook(channelId: string, name: string): Promise<Result<{ id: string; url: string; token: string }>> {
        const [data, fetchErr] = await safeFetch<{ id: string; token: string }>(
            `${DISCORD.API_BASE}/channels/${channelId}/webhooks`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bot ${env.discord.botToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name }),
            },
        )
        if (fetchErr) return err({ code: ERROR_CODES.WEBHOOK_ERROR, message: 'Failed to create webhook', cause: fetchErr })
        return ok({ id: data.id, url: `${DISCORD.API_BASE}/webhooks/${data.id}/${data.token}`, token: data.token })
    }

    async deleteWebhook(webhookId: string, token: string): Promise<Result<void>> {
        try {
            const res = await fetch(`${DISCORD.API_BASE}/webhooks/${webhookId}/${token}`, { method: 'DELETE' })
            if (!res.ok) return err({ code: ERROR_CODES.WEBHOOK_ERROR, message: `Failed to delete webhook: ${res.status}` })
            return ok(undefined)
        } catch (cause) {
            return err({ code: ERROR_CODES.WEBHOOK_ERROR, message: 'Failed to delete webhook', cause })
        }
    }

    async isBotInGuild(guildId: string): Promise<boolean> {
        try {
            const res = await fetch(`${DISCORD.API_BASE}/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${env.discord.botToken}` },
            })
            return res.ok
        } catch {
            return false
        }
    }

    hasPermission(permissions: number, permission: number): boolean {
        return (permissions & permission) === permission
    }

    avatarUrl(userId: string, hash: string | null): string | null {
        if (!hash) return null
        return `${DISCORD.CDN_BASE}/avatars/${userId}/${hash}.webp`
    }

    guildIconUrl(guildId: string, hash: string | null): string | null {
        if (!hash) return null
        return `${DISCORD.CDN_BASE}/icons/${guildId}/${hash}.webp`
    }
}
