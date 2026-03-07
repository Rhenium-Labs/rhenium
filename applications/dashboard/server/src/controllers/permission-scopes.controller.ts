import * as z from 'zod'
import { snowflake } from '../services/schemas/common'
import { SetPermissionScopeSchema, RemovePermissionScopeSchema } from '../services/schemas/permission-scopes.schema'
import type { PermissionScopesService } from '../services/permission-scopes.service'
import type { RouterFn, GuildProcedureBuilder, GuildWriteProcedureBuilder } from '../procedures'

export function createPermissionScopesController(
    router: RouterFn,
    guildProcedure: GuildProcedureBuilder,
    guildWriteProcedure: GuildWriteProcedureBuilder,
    service: PermissionScopesService,
) {
    return router({
        list: guildProcedure
            .input(z.object({ guildId: snowflake }))
            .query(async ({ input }) => service.list(input.guildId)),

        set: guildWriteProcedure
            .input(SetPermissionScopeSchema)
            .mutation(async ({ input }) =>
                service.set(input.guildId, input.role_id, input.allowed_permissions),
            ),

        remove: guildWriteProcedure
            .input(RemovePermissionScopeSchema)
            .mutation(async ({ input }) =>
                service.remove(input.guildId, input.role_id),
            ),
    })
}
