import { ErrorBuilder } from '../errors/builder'
import type { DiscordRepository } from '../repositories/discord.repository'
import type { AuthorizationService, ManageableGuild } from './authorization.service'

export interface ChannelInfo {
    id: string
    name: string
    type: number
    parent_id: string | null
    position: number
}

export interface RoleInfo {
    id: string
    name: string
    color: number
    position: number
}

/** Channel types: GUILD_TEXT (0), GUILD_VOICE (2), GUILD_ANNOUNCEMENT (5), GUILD_STAGE_VOICE (15) */
const TEXTABLE_CHANNEL_TYPES = [0, 2, 5, 15]

export class DiscordService {
    constructor(
        private discordRepo: DiscordRepository,
        private authorizationService: AuthorizationService,
    ) {}

    /** Fetch channels for a guild (text, voice, announcement, stage). */
    async getChannels(guildId: string): Promise<ChannelInfo[]> {
        const [channels, err] = await this.discordRepo.getGuildChannels(guildId)
        if (err) ErrorBuilder.internal('Failed to fetch guild channels').cause(err.cause).throw()
        return channels!
            .filter((c) => TEXTABLE_CHANNEL_TYPES.includes(c.type))
            .map((c) => ({
                id: c.id,
                name: c.name,
                type: c.type,
                parent_id: c.parent_id,
                position: c.position,
            }))
            .sort((a, b) => a.position - b.position)
    }

    /** Fetch roles for a guild (excluding @everyone). */
    async getRoles(guildId: string): Promise<RoleInfo[]> {
        const [roles, err] = await this.discordRepo.getGuildRoles(guildId)
        if (err) ErrorBuilder.internal('Failed to fetch guild roles').cause(err.cause).throw()
        return roles!
            .filter((r) => r.id !== guildId)
            .map((r) => ({
                id: r.id,
                name: r.name,
                color: r.color,
                position: r.position,
            }))
            .sort((a, b) => b.position - a.position)
    }

    /** Fetch all guilds where the user has ADMINISTRATOR or MANAGE_GUILD. */
    async getManageableGuilds(userId: string): Promise<ManageableGuild[]> {
        return this.authorizationService.getManageableGuilds(userId)
    }

    /** Fetch emojis for a guild. */
    async getEmojis(guildId: string) {
        const [emojis, err] = await this.discordRepo.getGuildEmojis(guildId)
        if (err) ErrorBuilder.internal('Failed to fetch guild emojis').cause(err.cause).throw()
        return emojis!.map((e) => ({
            id: e.id,
            name: e.name,
            animated: e.animated,
            imageURL: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'webp'}`,
        }))
    }
}
