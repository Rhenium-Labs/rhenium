import { router, authedProcedure } from '../trpc'
import { ErrorBuilder, safeQuery } from '../errors'
import { getDiscordToken } from '../utils/discord-session'
import { discordApi } from '../utils/discord'

export const authRouter = router({
    me: authedProcedure.query(async ({ ctx }) => {
        const [guilds, queryErr] = await safeQuery(() =>
            ctx.db
                .selectFrom('Whitelist')
                .select('id')
                .execute(),
        )
        if (queryErr) ErrorBuilder.internal().cause(queryErr.cause).throw()

        const whitelistedIds = new Set(guilds!.map((g) => g.id))

        return {
            user: ctx.user,
            isDeveloper: ctx.isDeveloper,
            whitelistedGuilds: Array.from(whitelistedIds),
        }
    }),

    userInfo: authedProcedure.query(async ({ ctx }) => {
        const [accessToken, tokenErr] = await getDiscordToken(ctx.db, ctx.user!.id)
        if (tokenErr) ErrorBuilder.unauthorized(tokenErr.message).throw()

        const [user, userErr] = await discordApi.getUser(accessToken!)
        if (userErr) ErrorBuilder.internal('Failed to fetch Discord user info').cause(userErr.cause).throw()

        return {
            id: user!.id,
            username: user!.username,
            avatar: discordApi.avatarUrl(user!.id, user!.avatar),
        }
    }),

    signout: authedProcedure.mutation(async ({ ctx }) => {
        const session = await ctx.db
            .selectFrom('Session')
            .select('access_token')
            .where('user_id', '=', ctx.user!.id)
            .executeTakeFirst()

        if (session) {
            await discordApi.revokeToken(session.access_token)
            await ctx.db.deleteFrom('Session').where('user_id', '=', ctx.user!.id).execute()
        }

        return { success: true }
    }),
})

export type AuthRouter = typeof authRouter
