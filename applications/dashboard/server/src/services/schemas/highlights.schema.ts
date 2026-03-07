import { z } from 'zod'
import { LIMITS } from '../../constants'

export const HighlightsConfigSchema = z.object({
    enabled: z.boolean(),
    max_patterns: z.number().int().min(LIMITS.HIGHLIGHT_MAX_PATTERNS.MIN).max(LIMITS.HIGHLIGHT_MAX_PATTERNS.MAX),
})

export const HighlightsConfigUpdateSchema = HighlightsConfigSchema.partial()
export type HighlightsConfigUpdate = z.infer<typeof HighlightsConfigUpdateSchema>
