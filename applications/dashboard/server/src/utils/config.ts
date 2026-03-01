import { GUILD_CONFIG_SCHEMA, type RawGuildConfig } from '@repo/config'
import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'
import { safeQuery, safeParse } from './safe'
import { ok, err, type Result } from '../types/result'
import { ERROR_CODES } from '../constants/errors'

export async function getGuildConfig(
    db: Kysely<DashboardDB>,
    guildId: string,
): Promise<Result<RawGuildConfig>> {
    const [guild, queryErr] = await safeQuery(() =>
        db.selectFrom('Guild').select('config').where('id', '=', guildId).executeTakeFirst(),
    )
    if (queryErr) return err({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Failed to fetch guild config', cause: queryErr.cause })
    if (!guild) return err({ code: ERROR_CODES.NOT_FOUND, message: 'Guild not found' })

    const [config, parseErr] = safeParse(() => GUILD_CONFIG_SCHEMA.parse(guild.config))
    if (parseErr) return err({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Invalid guild config', cause: parseErr.cause })

    return ok(config)
}

export async function updateGuildConfig(
    db: Kysely<DashboardDB>,
    guildId: string,
    updater: (config: RawGuildConfig) => RawGuildConfig,
): Promise<Result<RawGuildConfig>> {
    const [current, getErr] = await getGuildConfig(db, guildId)
    if (getErr) return [null, getErr]

    const updated = updater(current)

    const [, writeErr] = await safeQuery(() =>
        db.updateTable('Guild')
            .set({ config: JSON.stringify(updated) })
            .where('id', '=', guildId)
            .execute(),
    )
    if (writeErr) return err({ code: ERROR_CODES.INTERNAL_ERROR, message: 'Failed to update guild config', cause: writeErr.cause })

    return ok(updated)
}
