import { Hono } from 'hono'
import { DISCORD } from '../constants'
import { env } from '../utils/env'
import { jwt } from '../utils/jwt'
import { discordApi } from '../utils/discord'
import { getDatabase } from '../database'

const auth = new Hono()

auth.get('/discord', (c) => {
    const params = new URLSearchParams({
        client_id: env.discord.clientId,
        redirect_uri: env.discord.redirectUri,
        response_type: 'code',
        scope: DISCORD.OAUTH2_SCOPES.join(' '),
    })

    return c.redirect(`${DISCORD.OAUTH2_AUTHORIZE_URL}?${params.toString()}`)
})

auth.get('/discord/callback', async (c) => {
    const code = c.req.query('code')

    if (!code) {
        return c.json({ error: 'Missing code parameter' }, 400)
    }

    const [tokenData, tokenErr] = await discordApi.exchangeCode(code)
    if (tokenErr) {
        return c.json({ error: 'Discord token exchange failed', detail: tokenErr.message }, 502)
    }

    const [user, userErr] = await discordApi.getUser(tokenData.access_token)
    if (userErr) {
        return c.json({ error: 'Failed to fetch Discord user', detail: userErr.message }, 502)
    }

    const db = getDatabase()
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

    await db
        .insertInto('Session')
        .values({
            user_id: user.id,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: expiresAt,
        })
        .onConflict((oc) =>
            oc.column('user_id').doUpdateSet({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: expiresAt,
            }),
        )
        .execute()

    const token = await jwt.sign({
        sub: user.id,
        username: user.username,
        avatar: user.avatar,
    })

    return c.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } })
})

auth.post('/signout', async (c) => {
    const authHeader = c.req.header('Authorization')
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!bearerToken) {
        return c.json({ error: 'Missing authorization' }, 401)
    }

    try {
        const payload = await jwt.verify(bearerToken)
        const db = getDatabase()

        const session = await db
            .selectFrom('Session')
            .select('access_token')
            .where('user_id', '=', payload.sub)
            .executeTakeFirst()

        if (session) {
            await discordApi.revokeToken(session.access_token)
            await db.deleteFrom('Session').where('user_id', '=', payload.sub).execute()
        }

        return c.json({ success: true })
    } catch {
        return c.json({ success: true })
    }
})

export { auth as authRoutes }
