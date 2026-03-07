import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery } from '../errors/domain'

export class ContentFilterRepository {
    constructor(private db: Kysely<DashboardDB>) {}

    async findAlert(alertId: string) {
        return safeQuery(() =>
            this.db
                .selectFrom('ContentFilterAlert')
                .select(['id', 'guild_id', 'channel_id', 'offender_id', 'detectors', 'highest_score', 'mod_status', 'del_status', 'created_at'])
                .where('id', '=', alertId)
                .executeTakeFirst(),
        )
    }

    async findLogsByAlertId(alertId: string) {
        return safeQuery(() =>
            this.db
                .selectFrom('ContentFilterLog')
                .select(['content', 'created_at'])
                .where('alert_id', '=', alertId)
                .orderBy('created_at', 'asc')
                .execute(),
        )
    }
}
