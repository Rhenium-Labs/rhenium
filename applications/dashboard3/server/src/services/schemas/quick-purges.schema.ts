import { z } from 'zod'
import { channelScopingArray } from './common'
import { LIMITS } from '../../constants'

export const QuickPurgesConfigSchema = z.object({
    enabled: z.boolean(),
    max_limit: z.number().int().min(LIMITS.PURGE_LIMIT.MIN).max(LIMITS.PURGE_LIMIT.MAX),
    channel_scoping: channelScopingArray,
})

export const QuickPurgesConfigUpdateSchema = QuickPurgesConfigSchema.partial()
export type QuickPurgesConfigUpdate = z.infer<typeof QuickPurgesConfigUpdateSchema>
