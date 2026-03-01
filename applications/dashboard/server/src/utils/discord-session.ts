import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { discordApi } from './discord'
import { ok, err, type Result } from '../types/result'
import { ERROR_CODES } from '../constants/errors'

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export async function getDiscordToken(
    db: Kysely<DashboardDB>,
    userId: string,
): Promise<Result<string>> {
    const session = await db
        .selectFrom('Session')
        .select(['access_token', 'refresh_token', 'expires_at'])
        .where('user_id', '=', userId)
        .executeTakeFirst()

    if (!session) {
        return err({ code: ERROR_CODES.UNAUTHORIZED, message: 'No Discord session found, please re-authenticate' })
    }

    const expiresAt = new Date(session.expires_at).getTime()
    const now = Date.now()

    if (now < expiresAt - TOKEN_REFRESH_BUFFER_MS) {
        return ok(session.access_token)
    }

    const [tokenData, refreshErr] = await discordApi.refreshToken(session.refresh_token)
    if (refreshErr) {
        return err({ code: ERROR_CODES.UNAUTHORIZED, message: 'Failed to refresh Discord token, please re-authenticate', cause: refreshErr })
    }

    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

    await db
        .updateTable('Session')
        .set({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: newExpiresAt,
        })
        .where('user_id', '=', userId)
        .execute()

    return ok(tokenData.access_token)
}
