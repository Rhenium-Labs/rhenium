import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'
import type { HighlightsConfigUpdate } from './schemas/highlights.schema'

export class HighlightsService {
    constructor(private configService: ConfigService) {}

    async getConfig(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.highlights
    }

    async updateConfig(guildId: string, data: HighlightsConfigUpdate) {
        const [updated, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            highlights: { ...config.highlights, ...data },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return updated!.highlights
    }
}
