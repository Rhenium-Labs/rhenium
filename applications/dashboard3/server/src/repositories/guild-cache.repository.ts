import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery, type Result } from '../errors/domain'

export interface CachedGuild {
    guild_id: string
    name: string
    icon: string | null
    permissions: string
    bot_in_guild: boolean
}

const TABLE = 'dashboard.UserGuildCache' as const

export class GuildCacheRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findByUserId(userId: string): Promise<Result<CachedGuild[]>> {
        return safeQuery(() =>
            this.db
                .selectFrom(TABLE)
                .select(['guild_id', 'name', 'icon', 'permissions', 'bot_in_guild'])
                .where('user_id', '=', userId)
                .execute(),
        )
    }

    async findCachedAt(userId: string): Promise<Result<Date | undefined>> {
        return safeQuery(async () => {
            const row = await this.db
                .selectFrom(TABLE)
                .select('cached_at')
                .where('user_id', '=', userId)
                .orderBy('cached_at', 'desc')
                .limit(1)
                .executeTakeFirst()
            return row?.cached_at ? new Date(row.cached_at) : undefined
        })
    }

    async replaceAll(
        userId: string,
        guilds: { guild_id: string; name: string; icon: string | null; permissions: string; bot_in_guild: boolean }[],
    ): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db.transaction().execute(async (tx) => {
                await tx.deleteFrom(TABLE).where('user_id', '=', userId).execute()

                if (guilds.length === 0) return

                await tx
                    .insertInto(TABLE)
                    .values(guilds.map((g) => ({ user_id: userId, ...g })))
                    .execute()
            })
        })
    }

    async deleteByUserId(userId: string): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db.deleteFrom(TABLE).where('user_id', '=', userId).execute()
        })
    }
}
