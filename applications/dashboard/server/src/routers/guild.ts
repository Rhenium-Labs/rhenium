import * as z from 'zod'
import { DEFAULT_GUILD_CONFIG } from '@repo/config'
import { router, authedProcedure } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder, safeQuery } from '../errors'
import { snowflake } from '../schemas/common'
import { DISCORD } from '../constants'
import { discordApi } from '../utils/discord'
import { getDiscordToken } from '../utils/discord-session'
import { getGuildConfig, updateGuildConfig } from '../utils/config'
import { env } from '../utils/env'

export const guildRouter = router({
    list: authedProcedure.query(async ({ ctx }) => {
        const [guilds, queryErr] = await safeQuery(() =>
            ctx.db
                .selectFrom('Whitelist')
                .select(['id', 'created_at'])
                .execute(),
        )
        if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()

        return guilds!
    }),

    userGuilds: authedProcedure.query(async ({ ctx }) => {
        const [accessToken, tokenErr] = await getDiscordToken(ctx.db, ctx.user!.id)
        if (tokenErr) ErrorBuilder.unauthorized(tokenErr.message).throw()

        const [allGuilds, guildsErr] = await discordApi.getGuilds(accessToken!)
        if (guildsErr) ErrorBuilder.internal('Failed to fetch guilds from Discord').cause(guildsErr.cause).throw()

        const [whitelisted, whitelistErr] = await safeQuery(() =>
            ctx.db.selectFrom('Whitelist').select('id').execute(),
        )
        if (whitelistErr) ErrorBuilder.internal().cause(whitelistErr.cause).throw()

        const whitelistedIds = new Set(whitelisted!.map((w) => w.id))

        return allGuilds!.filter((g) => {
            const hasAdmin = discordApi.hasPermission(g.permissions, 0x8)
            const hasManageGuild = discordApi.hasPermission(g.permissions, DISCORD.PERMISSIONS.MANAGE_GUILD)
            return hasAdmin || hasManageGuild
        }).map((g) => ({
            id: g.id,
            name: g.name,
            icon: discordApi.guildIconUrl(g.id, g.icon),
            whitelisted: whitelistedIds.has(g.id),
        }))
    }),

    get: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return {
                id: input.guildId,
                features: {
                    message_reports: { enabled: config!.message_reports.enabled },
                    ban_requests: { enabled: config!.ban_requests.enabled },
                    content_filter: { enabled: config!.content_filter.enabled },
                    highlights: { enabled: config!.highlights.enabled },
                    quick_mutes: { enabled: config!.quick_mutes.enabled },
                    quick_purges: { enabled: config!.quick_purges.enabled },
                },
            }
        }),

    fullConfig: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!
        }),

    resetConfig: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .mutation(async ({ ctx, input }) => {
            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, () => DEFAULT_GUILD_CONFIG)
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),

    channels: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ input }) => {
            const [channels, channelsErr] = await discordApi.getGuildChannels(input.guildId, env.discord.botToken)
            if (channelsErr) ErrorBuilder.internal('Failed to fetch guild channels').cause(channelsErr.cause).throw()

            return channels!
                .filter((c) => [0, 2, 5, 15].includes(c.type))
                .map((c) => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    parent_id: c.parent_id,
                    position: c.position,
                }))
                .sort((a, b) => a.position - b.position)
        }),

    roles: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ input }) => {
            const [roles, rolesErr] = await discordApi.getGuildRoles(input.guildId, env.discord.botToken)
            if (rolesErr) ErrorBuilder.internal('Failed to fetch guild roles').cause(rolesErr.cause).throw()

            return roles!
                .filter((r) => r.id !== input.guildId)
                .map((r) => ({
                    id: r.id,
                    name: r.name,
                    color: r.color,
                    position: r.position,
                }))
                .sort((a, b) => b.position - a.position)
        }),

    emojis: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ input }) => {
            const [emojis, emojisErr] = await discordApi.getGuildEmojis(input.guildId, env.discord.botToken)
            if (emojisErr) ErrorBuilder.internal('Failed to fetch guild emojis').cause(emojisErr.cause).throw()

            return emojis!.map((e) => ({
                id: e.id,
                name: e.name,
                animated: e.animated,
                imageURL: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'webp'}`,
            }))
        }),
})

export type GuildRouter = typeof guildRouter
