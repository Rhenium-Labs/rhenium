import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery, type Result } from '../errors/domain'

export class TemporaryBanRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findByGuildId(guildId: string) {
        return safeQuery(() =>
            this.db
                .selectFrom('TemporaryBan')
                .select(['target_id', 'expires_at'])
                .where('guild_id', '=', guildId)
                .execute(),
        )
    }
}
