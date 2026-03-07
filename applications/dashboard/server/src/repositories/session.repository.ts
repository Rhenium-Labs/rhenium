import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery, type Result } from '../errors/domain'

interface SessionRow {
    access_token: string
    refresh_token: string
    expires_at: Date
}

const TABLE = 'dashboard.Session' as const

export class SessionRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findByUserId(userId: string): Promise<Result<SessionRow | undefined>> {
        return safeQuery(() =>
            this.db
                .selectFrom(TABLE)
                .select(['access_token', 'refresh_token', 'expires_at'])
                .where('user_id', '=', userId)
                .executeTakeFirst(),
        )
    }

    async findAccessToken(userId: string): Promise<Result<string | undefined>> {
        return safeQuery(async () => {
            const row = await this.db
                .selectFrom(TABLE)
                .select('access_token')
                .where('user_id', '=', userId)
                .executeTakeFirst()
            return row?.access_token
        })
    }

    async upsert(userId: string, accessToken: string, refreshToken: string, expiresAt: string): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db
                .insertInto(TABLE)
                .values({ user_id: userId, access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt })
                .onConflict((oc) =>
                    oc.column('user_id').doUpdateSet({ access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt }),
                )
                .execute()
        })
    }

    async update(userId: string, accessToken: string, refreshToken: string, expiresAt: string): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db
                .updateTable(TABLE)
                .set({ access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt })
                .where('user_id', '=', userId)
                .execute()
        })
    }

    async deleteByUserId(userId: string): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db.deleteFrom(TABLE).where('user_id', '=', userId).execute()
        })
    }
}
