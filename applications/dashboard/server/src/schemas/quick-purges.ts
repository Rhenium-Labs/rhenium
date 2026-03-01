import * as z from 'zod'
import { LIMITS } from '../constants'

export const QuickPurgesConfigSchema = z.object({
    enabled: z.boolean(),
    max_limit: z
        .number()
        .int()
        .min(LIMITS.PURGE_LIMIT.MIN)
        .max(LIMITS.PURGE_LIMIT.MAX),
})

export const QuickPurgesConfigUpdateSchema = QuickPurgesConfigSchema.partial()

export type QuickPurgesConfig = z.infer<typeof QuickPurgesConfigSchema>
export type QuickPurgesConfigUpdate = z.infer<typeof QuickPurgesConfigUpdateSchema>
