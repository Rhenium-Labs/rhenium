import { type RawGuildConfig } from '@repo/config'
import { type Result, ok, err } from '../errors/domain'
import { ERROR_CODES } from '../constants'
import type { GuildRepository } from '../repositories/guild.repository'
import { getDefaultGuildConfig } from '../resources/default-config'

export class ConfigService {
    constructor(private guildRepo: GuildRepository) {}

    async get(guildId: string): Promise<Result<RawGuildConfig>> {
        const [guild, queryErr] = await this.guildRepo.findConfig(guildId)
        if (queryErr) {
            return err({
                code: ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to fetch guild config',
                cause: queryErr.cause,
            })
        }

        if (!guild) {
            const initial = getDefaultGuildConfig()
            const [, writeErr] = await this.guildRepo.upsertConfig(guildId, initial)
            if (writeErr) {
                return err({
                    code: ERROR_CODES.INTERNAL_ERROR,
                    message: 'Failed to create default guild config',
                    cause: writeErr.cause,
                })
            }
            return ok(initial)
        }

        return ok(guild.config)
    }

    async getMany(guildIds: string[]): Promise<Result<Record<string, RawGuildConfig>>> {
        if (guildIds.length === 0) return ok({})

        const [rows, queryErr] = await this.guildRepo.findConfigs(guildIds)
        if (queryErr) {
            return err({
                code: ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to fetch guild configs',
                cause: queryErr.cause,
            })
        }

        const result: Record<string, RawGuildConfig> = {}
        const missingIds = new Set(guildIds)

        for (const row of rows ?? []) {
            result[row.id] = row.config
            missingIds.delete(row.id)
        }

        for (const guildId of missingIds) {
            result[guildId] = getDefaultGuildConfig()
        }

        return ok(result)
    }

    async update(guildId: string, updater: (config: RawGuildConfig) => RawGuildConfig): Promise<Result<RawGuildConfig>> {
        const [current, getErr] = await this.get(guildId)
        if (getErr) return [null, getErr]

        const updated = updater(current)

        const [, writeErr] = await this.guildRepo.upsertConfig(guildId, updated)
        if (writeErr) {
            return err({
                code: ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to update guild config',
                cause: writeErr.cause,
            })
        }

        return ok(updated)
    }
}
