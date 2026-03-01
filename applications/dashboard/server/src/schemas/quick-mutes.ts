import * as z from 'zod'
import { LIMITS } from '../constants'

export const QuickMutesConfigSchema = z.object({
    enabled: z.boolean(),
    purge_limit: z
        .number()
        .int()
        .min(LIMITS.PURGE_LIMIT.MIN)
        .max(LIMITS.PURGE_LIMIT.MAX),
})

export const QuickMutesConfigUpdateSchema = QuickMutesConfigSchema.partial()

export type QuickMutesConfig = z.infer<typeof QuickMutesConfigSchema>
export type QuickMutesConfigUpdate = z.infer<typeof QuickMutesConfigUpdateSchema>
