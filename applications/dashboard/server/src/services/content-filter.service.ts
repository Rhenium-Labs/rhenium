import type { RawChannelScoping } from '@repo/config'
import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'
import type { ContentFilterConfigUpdate } from './schemas/content-filter.schema'

export class ContentFilterService {
    constructor(private configService: ConfigService) {}

    async getConfig(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.content_filter
    }

    async updateConfig(guildId: string, data: ContentFilterConfigUpdate) {
        const [updated, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            content_filter: { ...config.content_filter, ...data },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return updated!.content_filter
    }

    async getChannelScoping(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.content_filter.channel_scoping
    }

    async setChannelScope(guildId: string, channelId: string, type: RawChannelScoping['type']) {
        const [, err] = await this.configService.update(guildId, (config) => {
            const scoping = config.content_filter.channel_scoping
            const entry: RawChannelScoping = { channel_id: channelId, type }
            const idx = scoping.findIndex((s: RawChannelScoping) => s.channel_id === channelId)
            const next = idx >= 0
                ? scoping.map((s: RawChannelScoping, i: number) => (i === idx ? entry : s))
                : [...scoping, entry]
            return { ...config, content_filter: { ...config.content_filter, channel_scoping: next } }
        })
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }

    async removeChannelScope(guildId: string, channelId: string) {
        const [, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            content_filter: {
                ...config.content_filter,
                channel_scoping: config.content_filter.channel_scoping.filter(
                    (s: RawChannelScoping) => s.channel_id !== channelId,
                ),
            },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }
}
