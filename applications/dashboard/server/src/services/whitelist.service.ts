import { ErrorBuilder } from '../errors/builder'
import type { WhitelistRepository } from '../repositories/whitelist.repository'

export class WhitelistService {
    constructor(private whitelistRepo: WhitelistRepository) {}

    async list() {
        const [guilds, err] = await this.whitelistRepo.findAll()
        if (err) ErrorBuilder.internal().cause(err.cause).throw()
        return guilds
    }

    async add(guildId: string) {
        const [existing] = await this.whitelistRepo.findById(guildId)
        if (existing) ErrorBuilder.conflict('Guild is already whitelisted').throw()

        const [, insertErr] = await this.whitelistRepo.add(guildId)
        if (insertErr) ErrorBuilder.internal().cause(insertErr.cause).throw()

        return { id: guildId }
    }

    async remove(guildId: string) {
        const [result, deleteErr] = await this.whitelistRepo.remove(guildId)
        if (deleteErr) ErrorBuilder.internal().cause(deleteErr.cause).throw()
        if (!result!.deleted) ErrorBuilder.notFound('Guild not found in whitelist').throw()

        return { success: true }
    }
}
