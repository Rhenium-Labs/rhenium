import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery, type Result } from '../errors/domain'

export class WhitelistRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findAll(): Promise<Result<{ id: string; created_at: Date }[]>> {
        return safeQuery(() =>
            this.db.selectFrom('Whitelist').select(['id', 'created_at']).execute(),
        )
    }

    async findIds(): Promise<Result<string[]>> {
        return safeQuery(async () => {
            const rows = await this.db.selectFrom('Whitelist').select('id').execute()
            return rows.map((r) => r.id)
        })
    }

    async exists(guildId: string): Promise<boolean> {
        const [row] = await safeQuery(() =>
            this.db.selectFrom('Whitelist').select('id').where('id', '=', guildId).executeTakeFirst(),
        )
        return !!row
    }

    async add(guildId: string): Promise<Result<void>> {
        return safeQuery(async () => {
            await this.db.insertInto('Whitelist').values({ id: guildId }).execute()
        })
    }

    async remove(guildId: string): Promise<Result<{ deleted: boolean }>> {
        return safeQuery(async () => {
            const result = await this.db
                .deleteFrom('Whitelist')
                .where('id', '=', guildId)
                .executeTakeFirst()
            return { deleted: !!result.numDeletedRows }
        })
    }

    async findById(guildId: string): Promise<Result<{ id: string } | undefined>> {
        return safeQuery(() =>
            this.db.selectFrom('Whitelist').select('id').where('id', '=', guildId).executeTakeFirst(),
        )
    }
}
