import { ErrorBuilder } from '../errors/builder'
import { ok, err, type Result } from '../errors/domain'
import { ERROR_CODES } from '../constants'
import { jwtService, type JwtPayload } from '../security/jwt'
import type { SessionRepository } from '../repositories/session.repository'
import type { WhitelistRepository } from '../repositories/whitelist.repository'
import type { DiscordRepository } from '../repositories/discord.repository'

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export class AuthService {
    constructor(
        private sessionRepo: SessionRepository,
        private whitelistRepo: WhitelistRepository,
        private discordRepo: DiscordRepository,
    ) {}

    async getMe(userId: string) {
        const [ids, idsErr] = await this.whitelistRepo.findIds()
        if (idsErr) ErrorBuilder.internal().cause(idsErr.cause).throw()
        return { whitelistedGuilds: ids }
    }

    async getUserInfo(userId: string) {
        const [accessToken, tokenErr] = await this.getDiscordToken(userId)
        if (tokenErr) ErrorBuilder.unauthorized(tokenErr.message).throw()

        const [user, userErr] = await this.discordRepo.getUser(accessToken!)
        if (userErr) ErrorBuilder.internal('Failed to fetch Discord user info').cause(userErr.cause).throw()

        return {
            id: user!.id,
            username: user!.username,
            avatar: this.discordRepo.avatarUrl(user!.id, user!.avatar),
        }
    }

    async exchangeCodeAndCreateSession(code: string) {
        const [tokenData, tokenErr] = await this.discordRepo.exchangeCode(code)
        if (tokenErr) return err({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Discord token exchange failed', cause: tokenErr })

        const [user, userErr] = await this.discordRepo.getUser(tokenData.access_token)
        if (userErr) return err({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Failed to fetch Discord user', cause: userErr })

        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        const [, sessionErr] = await this.sessionRepo.upsert(user.id, tokenData.access_token, tokenData.refresh_token, expiresAt)
        if (sessionErr) return err({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Failed to save session', cause: sessionErr })

        const jwt = await jwtService.sign({ sub: user.id, username: user.username, avatar: user.avatar })
        return ok({ token: jwt, user: { id: user.id, username: user.username, avatar: user.avatar } })
    }

    async signout(userId: string) {
        const [accessToken] = await this.sessionRepo.findAccessToken(userId)
        if (accessToken) {
            await this.discordRepo.revokeToken(accessToken)
            await this.sessionRepo.deleteByUserId(userId)
        }
        return { success: true }
    }

    async getDiscordToken(userId: string): Promise<Result<string>> {
        const [session, sessionErr] = await this.sessionRepo.findByUserId(userId)
        if (sessionErr) return err({ code: ERROR_CODES.UNAUTHORIZED, message: 'Failed to load session' })
        if (!session) return err({ code: ERROR_CODES.UNAUTHORIZED, message: 'No Discord session found, please re-authenticate' })

        const expiresAt = new Date(session.expires_at).getTime()
        if (Date.now() < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
            return ok(session.access_token)
        }

        const [tokenData, refreshErr] = await this.discordRepo.refreshToken(session.refresh_token)
        if (refreshErr) return err({ code: ERROR_CODES.UNAUTHORIZED, message: 'Failed to refresh Discord token, please re-authenticate', cause: refreshErr })

        const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        await this.sessionRepo.update(userId, tokenData.access_token, tokenData.refresh_token, newExpiresAt)

        return ok(tokenData.access_token)
    }
}
