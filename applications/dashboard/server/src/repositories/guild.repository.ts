import type { Kysely } from 'kysely'
import { parseConfigSafe, type RawGuildConfig } from '@repo/config'
import type { DashboardDB } from '../database/types'
import { ok, safeQuery, type Result } from '../errors/domain'

export class GuildRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findConfig(guildId: string): Promise<Result<{ config: RawGuildConfig } | undefined>> {
        return safeQuery(async () => {
            const row = await this.db.selectFrom('Guild').select('config').where('id', '=', guildId).executeTakeFirst()
            if (!row) return undefined
            return { config: parseConfigSafe(row.config) }
        })
    }

    async upsertConfig(guildId: string, config: RawGuildConfig): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db
                .insertInto('Guild')
                .values({ id: guildId, config })
                .onConflict((oc) => oc.column('id').doUpdateSet({ config }))
                .execute()
        })
    }

    async findConfigs(guildIds: string[]): Promise<Result<{ id: string; config: RawGuildConfig }[]>> {
        if (guildIds.length === 0) return ok([])
        return safeQuery(async () => {
            const rows = await this.db
                .selectFrom('Guild')
                .select(['id', 'config'])
                .where('id', 'in', guildIds)
                .execute()
            return rows.map((row) => ({ id: row.id, config: parseConfigSafe(row.config) }))
        })
    }
}
