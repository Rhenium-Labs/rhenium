import { z } from 'zod'
import { channelScopingArray } from './common'
import { LIMITS } from '../../constants'

export const QuickMutesConfigSchema = z.object({
    enabled: z.boolean(),
    purge_limit: z.number().int().min(LIMITS.PURGE_LIMIT.MIN).max(LIMITS.PURGE_LIMIT.MAX),
    channel_scoping: channelScopingArray,
})

export const QuickMutesConfigUpdateSchema = QuickMutesConfigSchema.partial()
export type QuickMutesConfigUpdate = z.infer<typeof QuickMutesConfigUpdateSchema>
