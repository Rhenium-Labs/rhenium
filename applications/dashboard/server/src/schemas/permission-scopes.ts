import { z } from 'zod'
import { UserPermission } from '@repo/config'
import { snowflake } from './common'

export const PermissionScopeSchema = z.object({
    role_id: snowflake,
    allowed_permissions: z.array(z.enum(UserPermission)),
})

export const SetPermissionScopeSchema = z.object({
    guildId: snowflake,
    role_id: snowflake,
    allowed_permissions: z.array(z.enum(UserPermission)),
})

export const RemovePermissionScopeSchema = z.object({
    guildId: snowflake,
    role_id: snowflake,
})
