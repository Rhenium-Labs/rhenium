import type { AuthService } from '../services/auth.service'
import type { RouterFn, AuthedProcedureBuilder } from '../procedures'

export function createAuthTrpcController(router: RouterFn, authedProcedure: AuthedProcedureBuilder, service: AuthService) {
    return router({
        me: authedProcedure.query(async ({ ctx }) => {
            const result = await service.getMe(ctx.user.id)
            return { user: ctx.user, ...result }
        }),

        userInfo: authedProcedure.query(async ({ ctx }) =>
            service.getUserInfo(ctx.user.id),
        ),

        signout: authedProcedure.mutation(async ({ ctx }) =>
            service.signout(ctx.user.id),
        ),
    })
}
