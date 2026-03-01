import * as z from 'zod'
import type { PermissionScope } from '@repo/config'
import { router } from '../trpc'
import { guildProcedure } from '../trpc/guild'
import { ErrorBuilder } from '../errors'
import { snowflake } from '../schemas/common'
import { SetPermissionScopeSchema, RemovePermissionScopeSchema } from '../schemas/permission-scopes'
import { getGuildConfig, updateGuildConfig } from '../utils/config'

export const permissionScopesRouter = router({
    list: guildProcedure
        .input(z.object({ guildId: snowflake }))
        .query(async ({ ctx, input }) => {
            const [config, configErr] = await getGuildConfig(ctx.db, input.guildId)
            if (configErr) ErrorBuilder.fromAppError(configErr).throw()

            return config!.permission_scopes
        }),

    set: guildProcedure
        .input(SetPermissionScopeSchema)
        .mutation(async ({ ctx, input }) => {
            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => {
                const scopes = config.permission_scopes
                const idx = scopes.findIndex((s: PermissionScope) => s.role_id === input.role_id)
                const entry: PermissionScope = {
                    role_id: input.role_id,
                    allowed_permissions: input.allowed_permissions,
                }
                const next = idx >= 0
                    ? scopes.map((s: PermissionScope, i: number) => (i === idx ? entry : s))
                    : [...scopes, entry]
                return { ...config, permission_scopes: next }
            })
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),

    remove: guildProcedure
        .input(RemovePermissionScopeSchema)
        .mutation(async ({ ctx, input }) => {
            const [, updateErr] = await updateGuildConfig(ctx.db, input.guildId, (config) => ({
                ...config,
                permission_scopes: config.permission_scopes.filter(
                    (s: PermissionScope) => s.role_id !== input.role_id,
                ),
            }))
            if (updateErr) ErrorBuilder.fromAppError(updateErr).throw()

            return { success: true }
        }),
})

export type PermissionScopesRouter = typeof permissionScopesRouter
