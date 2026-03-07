import type { RawChannelScoping } from '@repo/config'
import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'
import type { QuickMutesConfigUpdate } from './schemas/quick-mutes.schema'

export class QuickMutesService {
    constructor(private configService: ConfigService) {}

    async getConfig(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.quick_mutes
    }

    async updateConfig(guildId: string, data: QuickMutesConfigUpdate) {
        const [updated, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            quick_mutes: { ...config.quick_mutes, ...data },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return updated!.quick_mutes
    }

    async getChannelScoping(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.quick_mutes.channel_scoping
    }

    async setChannelScope(guildId: string, channelId: string, type: RawChannelScoping['type']) {
        const [, err] = await this.configService.update(guildId, (config) => {
            const scoping = config.quick_mutes.channel_scoping
            const entry: RawChannelScoping = { channel_id: channelId, type }
            const idx = scoping.findIndex((s: RawChannelScoping) => s.channel_id === channelId)
            const next = idx >= 0
                ? scoping.map((s: RawChannelScoping, i: number) => (i === idx ? entry : s))
                : [...scoping, entry]
            return { ...config, quick_mutes: { ...config.quick_mutes, channel_scoping: next } }
        })
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }

    async removeChannelScope(guildId: string, channelId: string) {
        const [, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            quick_mutes: {
                ...config.quick_mutes,
                channel_scoping: config.quick_mutes.channel_scoping.filter(
                    (s: RawChannelScoping) => s.channel_id !== channelId,
                ),
            },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }
}
