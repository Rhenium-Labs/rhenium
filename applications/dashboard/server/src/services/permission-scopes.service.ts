import type { PermissionScope } from '@repo/config'
import { ErrorBuilder } from '../errors/builder'
import type { ConfigService } from './config.service'

export class PermissionScopesService {
    constructor(private configService: ConfigService) {}

    async list(guildId: string) {
        const [config, err] = await this.configService.get(guildId)
        if (err) ErrorBuilder.fromAppError(err).throw()
        return config!.permission_scopes
    }

    async set(guildId: string, roleId: string, allowedPermissions: PermissionScope['allowed_permissions']) {
        const [, err] = await this.configService.update(guildId, (config) => {
            const scopes = config.permission_scopes
            const entry: PermissionScope = { role_id: roleId, allowed_permissions: allowedPermissions }
            const idx = scopes.findIndex((s: PermissionScope) => s.role_id === roleId)
            const next = idx >= 0
                ? scopes.map((s: PermissionScope, i: number) => (i === idx ? entry : s))
                : [...scopes, entry]
            return { ...config, permission_scopes: next }
        })
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }

    async remove(guildId: string, roleId: string) {
        const [, err] = await this.configService.update(guildId, (config) => ({
            ...config,
            permission_scopes: config.permission_scopes.filter(
                (s: PermissionScope) => s.role_id !== roleId,
            ),
        }))
        if (err) ErrorBuilder.fromAppError(err).throw()
        return { success: true }
    }
}
