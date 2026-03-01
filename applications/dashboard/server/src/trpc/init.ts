import { initTRPC } from '@trpc/server'
import { formatTRPCError } from '../errors'
import type { Context } from './context'

export const t = initTRPC.context<Context>().create({
    errorFormatter({ shape, error }) {
        const formatted = formatTRPCError(error)
        return {
            ...shape,
            data: {
                ...shape.data,
                appError: formatted,
            },
        }
    },
})
