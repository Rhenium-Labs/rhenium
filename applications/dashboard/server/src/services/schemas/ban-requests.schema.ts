import { z } from 'zod'
import { snowflake, snowflakeArray, webhookUrl } from './common'

export const BanRequestsConfigSchema = z.object({
    enabled: z.boolean(),
    webhook_url: webhookUrl,
    webhook_channel: snowflake.nullable(),
    immune_roles: snowflakeArray,
    notify_roles: snowflakeArray,
    enforce_submission_reason: z.boolean(),
    enforce_deny_reason: z.boolean(),
})

export const BanRequestsConfigUpdateSchema = BanRequestsConfigSchema.partial()
export type BanRequestsConfigUpdate = z.infer<typeof BanRequestsConfigUpdateSchema>
