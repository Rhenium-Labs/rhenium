import { ErrorBuilder } from '../errors/builder'
import type { TemporaryBanRepository } from '../repositories/temporary-ban.repository'

export class TemporaryBansService {
    constructor(private tempBanRepo: TemporaryBanRepository) {}

    async list(guildId: string) {
        const [bans, err] = await this.tempBanRepo.findByGuildId(guildId)
        if (err) ErrorBuilder.internal().cause(err.cause).throw()
        return bans
    }
}
