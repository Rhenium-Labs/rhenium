import { z } from 'zod'
import { snowflakeArray, webhookUrl } from './common'
import { DetectorMode, ContentFilterVerbosity, ChannelScopingType } from '@repo/config'
import { Detector } from '@repo/db'

export const ContentFilterConfigSchema = z.object({
    enabled: z.boolean(),
    use_native_automod: z.boolean(),
    webhook_url: webhookUrl.optional(),
    detectors: z.array(z.enum(Detector)),
    detector_mode: z.enum(DetectorMode),
    verbosity: z.enum(ContentFilterVerbosity),
    immune_roles: snowflakeArray,
    notify_roles: snowflakeArray,
    ocr_filter_keywords: z.array(z.string()),
    ocr_filter_regex: z.array(z.string().refine((v) => {
        try {
            new RegExp(v)
            return true
        } catch {
            return false
        }
    }, { message: 'Invalid regex pattern' })),
})

export const ContentFilterConfigUpdateSchema = ContentFilterConfigSchema.partial()

export const ChannelScopingUpdateSchema = z.object({
    type: z.enum(ChannelScopingType),
})

export type ContentFilterConfig = z.infer<typeof ContentFilterConfigSchema>
export type ContentFilterConfigUpdate = z.infer<typeof ContentFilterConfigUpdateSchema>
