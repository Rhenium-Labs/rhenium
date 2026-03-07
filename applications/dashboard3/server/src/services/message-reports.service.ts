import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'
import type { MessageReportsConfigUpdate } from './schemas/message-reports.schema'
import { getDefaultGuildConfig } from '../resources/default-config'

export class MessageReportsService {
    constructor(private configService: ConfigService) {}

    async getConfig(guildId: string) {
        const [config] = await this.configService.get(guildId)
        const effective = config ?? getDefaultGuildConfig()
        return effective.message_reports
    }

    async updateConfig(guildId: string, data: MessageReportsConfigUpdate) {
        const [updated, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            message_reports: { ...config.message_reports, ...data },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return updated!.message_reports
    }

    async getBlacklist(guildId: string) {
        const [config] = await this.configService.get(guildId)
        const effective = config ?? getDefaultGuildConfig()
        return effective.message_reports.blacklisted_users
    }

    async addToBlacklist(guildId: string, userId: string) {
        const [updated, err] = await this.configService.update(guildId, (config) => {
            const current = config.message_reports.blacklisted_users
            if (current.includes(userId)) return config
            return {
                ...config,
                message_reports: { ...config.message_reports, blacklisted_users: [...current, userId] },
            }
        })
        if (err) ErrorBuilder.fromAppError(err).throw()
        return updated!.message_reports.blacklisted_users
    }

    async removeFromBlacklist(guildId: string, userId: string) {
        const [updated, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            message_reports: {
                ...config.message_reports,
                blacklisted_users: config.message_reports.blacklisted_users.filter((id: string) => id !== userId),
            },
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return updated!.message_reports.blacklisted_users
    }
}
