import { ErrorBuilder } from '../errors'
import type { AuthUser } from './context'
import { t } from './init'
import { standardRateLimit, strictRateLimit } from './rate-limit'

export const router = t.router
export const publicProcedure = t.procedure.use(standardRateLimit)

const authMiddleware = t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) {
        ErrorBuilder.unauthorized().throw()
    }

    return next({
        ctx: {
            ...ctx,
            user: ctx.user as AuthUser,
        },
    })
})

const devMiddleware = t.middleware(async ({ ctx, next }) => {
    if (!ctx.isDeveloper) {
        ErrorBuilder.forbidden('Developer access required').throw()
    }

    return next({ ctx })
})

export const authedProcedure = publicProcedure.use(authMiddleware)
export const devProcedure = authedProcedure.use(devMiddleware).use(strictRateLimit)
