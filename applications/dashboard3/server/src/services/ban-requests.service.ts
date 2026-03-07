import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'
import type { BanRequestsConfigUpdate } from './schemas/ban-requests.schema'

export class BanRequestsService {
    constructor(private configService: ConfigService) {}

    async getConfig(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.ban_requests
    }

    async updateConfig(guildId: string, data: BanRequestsConfigUpdate) {
        const [updated, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            ban_requests: { ...config.ban_requests, ...data },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return updated!.ban_requests
    }
}
