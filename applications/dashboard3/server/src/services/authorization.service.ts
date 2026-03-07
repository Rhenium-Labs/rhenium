import { DISCORD } from '../constants'
import { ErrorBuilder } from '../errors/builder'
import type { AuthService } from './auth.service'
import type { WhitelistRepository } from '../repositories/whitelist.repository'
import type { DiscordRepository } from '../repositories/discord.repository'
import type { GuildCacheRepository } from '../repositories/guild-cache.repository'

const CACHE_TTL_MS = 5 * 60 * 1000

export interface ManageableGuild {
    id: string
    name: string
    icon: string | null
    whitelisted: boolean
    bot_in_guild: boolean
}

export class AuthorizationService {
    constructor(
        private authService: AuthService,
        private whitelistRepo: WhitelistRepository,
        private discordRepo: DiscordRepository,
        private guildCacheRepo: GuildCacheRepository,
    ) { }

    async getManageableGuilds(userId: string): Promise<ManageableGuild[]> {
        const cached = await this.getCachedGuilds(userId)
        if (cached) return cached

        return this.fetchAndCacheGuilds(userId)
    }

    async canManageGuild(userId: string, guildId: string): Promise<boolean> {
        const guilds = await this.getManageableGuilds(userId)
        // A user can manage a guild if they have the required Discord
        // permissions (ADMINISTRATOR or MANAGE_GUILD). We do not gate on
        // whether the bot is currently in the guild here – that flag is
        // only used for UI purposes.
        return guilds.some((g) => g.id === guildId)
    }

    private async getCachedGuilds(userId: string): Promise<ManageableGuild[] | null> {
        const [cachedAt] = await this.guildCacheRepo.findCachedAt(userId)
        if (!cachedAt || Date.now() - cachedAt.getTime() > CACHE_TTL_MS) return null

        const [guilds, err] = await this.guildCacheRepo.findByUserId(userId)
        if (err || !guilds) return null

        const [ids] = await this.whitelistRepo.findIds()
        const whitelistedIds = new Set(ids ?? [])

        return guilds.map((g) => ({
            id: g.guild_id,
            name: g.name,
            icon: g.icon,
            whitelisted: whitelistedIds.has(g.guild_id),
            bot_in_guild: g.bot_in_guild,
        }))
    }

    private async fetchAndCacheGuilds(userId: string): Promise<ManageableGuild[]> {
        const [accessToken, tokenErr] = await this.authService.getDiscordToken(userId)
        if (tokenErr) ErrorBuilder.unauthorized(tokenErr.message).throw()

        const [allGuilds, guildsErr] = await this.discordRepo.getGuilds(accessToken!)
        if (guildsErr) ErrorBuilder.internal('Failed to fetch guilds from Discord').cause(guildsErr.cause).throw()

        const [ids, idsErr] = await this.whitelistRepo.findIds()
        if (idsErr) ErrorBuilder.internal().cause(idsErr.cause).throw()

        const whitelistedIds = new Set(ids)

        const manageable = allGuilds!.filter((g) => {
            const hasAdmin = this.discordRepo.hasPermission(g.permissions, DISCORD.PERMISSIONS.ADMINISTRATOR)
            const hasManage = this.discordRepo.hasPermission(g.permissions, DISCORD.PERMISSIONS.MANAGE_GUILD)
            return hasAdmin || hasManage
        })

        const details = await Promise.all(
            manageable.map(async (g) => ({
                guild_id: g.id,
                name: g.name,
                icon: this.discordRepo.guildIconUrl(g.id, g.icon),
                permissions: String(g.permissions),
                bot_in_guild: await this.discordRepo.isBotInGuild(g.id),
            })),
        )

        await this.guildCacheRepo.replaceAll(userId, details)

        return details.map((entry) => ({
            id: entry.guild_id,
            name: entry.name,
            icon: entry.icon,
            whitelisted: whitelistedIds.has(entry.guild_id),
            bot_in_guild: entry.bot_in_guild,
        }))
    }
}

