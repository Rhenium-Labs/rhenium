import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery, type Result } from '../errors/domain'

const TABLE = 'dashboard.RoleCache' as const

export class RoleCacheRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findByGuildId(guildId: string): Promise<Result<{ role_id: string; name: string; color: number }[]>> {
        return safeQuery(() =>
            this.db
                .selectFrom(TABLE)
                .select(['role_id', 'name', 'color'])
                .where('guild_id', '=', guildId)
                .execute(),
        )
    }

    async replaceAll(
        guildId: string,
        roles: { role_id: string; name: string; color: number }[],
    ): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db.transaction().execute(async (tx) => {
                await tx.deleteFrom(TABLE).where('guild_id', '=', guildId).execute()

                if (roles.length === 0) return

                await tx
                    .insertInto(TABLE)
                    .values(roles.map((r) => ({ guild_id: guildId, ...r })))
                    .execute()
            })
        })
    }
}
