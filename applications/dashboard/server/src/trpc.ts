import { initTRPC } from '@trpc/server'
import { formatTRPCError } from './middleware/error-handler'
import type { AppContext } from './security/context'

export const t = initTRPC.context<AppContext>().create({
    errorFormatter({ shape, error }) {
        const formatted = formatTRPCError(error)
        return { ...shape, data: { ...shape.data, appError: formatted } }
    },
})
