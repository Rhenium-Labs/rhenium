import { Hono } from 'hono'
import { DISCORD } from '../constants'
import { env } from '../config/env'
import { jwtService } from '../security/jwt'
import type { AuthService } from '../services/auth.service'
import type { AuthorizationService } from '../services/authorization.service'

export function createAuthRestController(authService: AuthService, authorizationService: AuthorizationService) {
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
        if (!code) return c.json({ error: 'Missing code parameter' }, 400)

        const [result, err] = await authService.exchangeCodeAndCreateSession(code)
        if (err) return c.json({ error: err.message }, 502)

        // Enrich JWT with the list of manageable guilds for this user at login time.
        const guilds = await authorizationService.getManageableGuilds(result.user.id)

        const basePayload = await jwtService.verify(result.token)
        const tokenWithGuilds = await jwtService.sign({
            ...basePayload,
            guilds: guilds.map((g) => ({
                id: g.id,
                name: g.name,
                icon: g.icon,
                whitelisted: g.whitelisted,
                bot_in_guild: g.bot_in_guild,
            })),
        })

        return c.json({
            token: tokenWithGuilds,
            user: {
                id: result.user.id,
                username: result.user.username,
                avatar: result.user.avatar,
            },
        })
    })

    auth.post('/signout', async (c) => {
        const bearerToken = jwtService.extractBearer(c.req.header('Authorization'))
        if (!bearerToken) return c.json({ error: 'Missing authorization' }, 401)

        try {
            const payload = await jwtService.verify(bearerToken)
            await authService.signout(payload.sub)
            return c.json({ success: true })
        } catch {
            return c.json({ success: true })
        }
    })

    return auth
}
