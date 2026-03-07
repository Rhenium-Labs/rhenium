import { t } from '../trpc'
import { ErrorBuilder } from '../errors/builder'

export const authMiddleware = t.middleware(async ({ ctx, next }) => {
    if (!ctx.user) throw ErrorBuilder.unauthorized().build()
    return next({ ctx: { ...ctx, user: ctx.user } })
})
