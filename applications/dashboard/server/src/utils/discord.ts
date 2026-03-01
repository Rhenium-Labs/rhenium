import { DISCORD } from '../constants'
import { ERROR_CODES } from '../constants/errors'
import { ok, err, type Result } from '../types/result'
import { safeFetch } from './safe'

export interface DiscordUser {
    id: string
    username: string
    avatar: string | null
}

export interface DiscordGuild {
    id: string
    name: string
    icon: string | null
    permissions: number
}

export interface DiscordChannel {
    id: string
    name: string
    type: number
    parent_id: string | null
    position: number
}

export interface DiscordRole {
    id: string
    name: string
    color: number
    position: number
    permissions: string
}

export interface DiscordEmoji {
    id: string
    name: string
    animated: boolean
}

export const discordApi = {
    async exchangeCode(code: string): Promise<Result<{ access_token: string; refresh_token: string; expires_in: number }>> {
        const { clientId, clientSecret, redirectUri } = await import('./env').then(
            (m) => m.env.discord,
        )

        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
        })

        return safeFetch(DISCORD.OAUTH2_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        })
    },

    async refreshToken(refreshToken: string): Promise<Result<{ access_token: string; refresh_token: string; expires_in: number }>> {
        const { clientId, clientSecret } = await import('./env').then(
            (m) => m.env.discord,
        )

        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        })

        return safeFetch(DISCORD.OAUTH2_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        })
    },

    async getUser(accessToken: string): Promise<Result<DiscordUser>> {
        return safeFetch(`${DISCORD.API_BASE}/users/@me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
    },

    async getGuilds(accessToken: string): Promise<Result<DiscordGuild[]>> {
        return safeFetch(`${DISCORD.API_BASE}/users/@me/guilds`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        })
    },

    async getGuildChannels(guildId: string, botToken: string): Promise<Result<DiscordChannel[]>> {
        return safeFetch(`${DISCORD.API_BASE}/guilds/${guildId}/channels`, {
            headers: { Authorization: `Bot ${botToken}` },
        })
    },

    async getGuildRoles(guildId: string, botToken: string): Promise<Result<DiscordRole[]>> {
        return safeFetch(`${DISCORD.API_BASE}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${botToken}` },
        })
    },

    async getGuildEmojis(guildId: string, botToken: string): Promise<Result<DiscordEmoji[]>> {
        return safeFetch(`${DISCORD.API_BASE}/guilds/${guildId}/emojis`, {
            headers: { Authorization: `Bot ${botToken}` },
        })
    },

    async revokeToken(token: string): Promise<Result<void>> {
        const { clientId, clientSecret } = await import('./env').then((m) => m.env.discord)

        const body = new URLSearchParams({
            token,
            client_id: clientId,
            client_secret: clientSecret,
        })

        try {
            await fetch(DISCORD.OAUTH2_REVOKE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
            })
            return ok(undefined)
        } catch (cause) {
            return err({
                code: ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to revoke Discord token',
                cause,
            })
        }
    },

    hasPermission(permissions: number, permission: number): boolean {
        return (permissions & permission) === permission
    },

    avatarUrl(userId: string, hash: string | null): string | null {
        if (!hash) return null
        return `${DISCORD.CDN_BASE}/avatars/${userId}/${hash}.webp`
    },

    guildIconUrl(guildId: string, hash: string | null): string | null {
        if (!hash) return null
        return `${DISCORD.CDN_BASE}/icons/${guildId}/${hash}.webp`
    },
} as const
