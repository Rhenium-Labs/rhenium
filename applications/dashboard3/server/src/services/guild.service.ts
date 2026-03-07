import type { RawGuildConfig } from '@repo/config'
import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'
import type { DiscordService } from './discord.service'
import type { AuthorizationService, ManageableGuild } from './authorization.service'
import type { WhitelistRepository } from '../repositories/whitelist.repository'
import type { ChannelCacheRepository } from '../repositories/channel-cache.repository'
import type { RoleCacheRepository } from '../repositories/role-cache.repository'
import { getDefaultGuildConfig } from '../resources/default-config'

export class GuildService {
    constructor(
        private configService: ConfigService,
        private authorizationService: AuthorizationService,
        private whitelistRepo: WhitelistRepository,
        private discordService: DiscordService,
        private channelCacheRepo: ChannelCacheRepository,
        private roleCacheRepo: RoleCacheRepository,
    ) { }

    async listWhitelisted() {
        const [guilds, err] = await this.whitelistRepo.findAll()
        if (err) ErrorBuilder.internal().cause(err.cause).throw()
        return guilds!
    }

    async userGuilds(userId: string) {
        const allGuilds: ManageableGuild[] = await this.authorizationService.getManageableGuilds(userId)
        const guilds = allGuilds.filter((g) => g.bot_in_guild && g.whitelisted)

        const [configs, configErr] = await this.configService.getMany(guilds.map((g) => g.id))
        if (configErr) {
            console.error('[GuildService.userGuilds] Failed to fetch configs, falling back to defaults:', configErr.message, configErr.cause)
            const fallback: Record<string, RawGuildConfig> = {}
            for (const g of guilds) fallback[g.id] = getDefaultGuildConfig()
            return { guilds, configs: fallback }
        }
        return { guilds, configs: configs ?? {} }
    }

    async get(guildId: string) {
        const [config] = await this.configService.get(guildId)
        const effective = config ?? getDefaultGuildConfig()
        return {
            id: guildId,
            features: {
                message_reports: { enabled: effective.message_reports.enabled },
                ban_requests: { enabled: effective.ban_requests.enabled },
                content_filter: { enabled: effective.content_filter.enabled },
                highlights: { enabled: effective.highlights.enabled },
                quick_mutes: { enabled: effective.quick_mutes.enabled },
                quick_purges: { enabled: effective.quick_purges.enabled },
            },
        }
    }

    async fullConfig(guildId: string) {
        const [config] = await this.configService.get(guildId)
        return config ?? getDefaultGuildConfig()
    }

    async resetConfig(guildId: string) {
        const [, err] = await this.configService.update(guildId, () => getDefaultGuildConfig())
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }

    async channels(guildId: string) {
        const channels = await this.discordService.getChannels(guildId)
        this.channelCacheRepo.replaceAll(guildId, channels.map((c) => ({ channel_id: c.id, name: c.name }))).catch(() => {})
        return channels
    }

    async roles(guildId: string) {
        const roles = await this.discordService.getRoles(guildId)
        this.roleCacheRepo.replaceAll(guildId, roles.map((r) => ({ role_id: r.id, name: r.name, color: r.color }))).catch(() => {})
        return roles
    }

    async cachedChannels(guildId: string) {
        const [channels, err] = await this.channelCacheRepo.findByGuildId(guildId)
        if (err) return []
        return channels.map((c) => ({ id: c.channel_id, name: c.name }))
    }

    async cachedRoles(guildId: string) {
        const [roles, err] = await this.roleCacheRepo.findByGuildId(guildId)
        if (err) return []
        return roles.map((r) => ({ id: r.role_id, name: r.name, color: r.color }))
    }

    async emojis(guildId: string) {
        return this.discordService.getEmojis(guildId)
    }
}
