import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery, type Result } from '../errors/domain'

const TABLE = 'dashboard.ChannelCache' as const

export class ChannelCacheRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findByGuildId(guildId: string): Promise<Result<{ channel_id: string; name: string }[]>> {
        return safeQuery(() =>
            this.db
                .selectFrom(TABLE)
                .select(['channel_id', 'name'])
                .where('guild_id', '=', guildId)
                .execute(),
        )
    }

    async replaceAll(
        guildId: string,
        channels: { channel_id: string; name: string }[],
    ): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db.transaction().execute(async (tx) => {
                await tx.deleteFrom(TABLE).where('guild_id', '=', guildId).execute()

                if (channels.length === 0) return

                await tx
                    .insertInto(TABLE)
                    .values(channels.map((c) => ({ guild_id: guildId, ...c })))
                    .execute()
            })
        })
    }
}
