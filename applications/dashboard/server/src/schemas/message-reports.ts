import { z } from 'zod'
import { snowflake, snowflakeArray, webhookUrl } from './common'

export const MessageReportsConfigSchema = z.object({
    enabled: z.boolean(),
    webhook_url: webhookUrl,
    webhook_channel: snowflake.nullable().optional(),
    auto_disregard_after: z.string(),
    delete_submission_on_handle: z.boolean(),
    immune_roles: snowflakeArray,
    notify_roles: snowflakeArray,
    blacklisted_users: snowflakeArray,
    placeholder_reason: z.string().nullable(),
    enforce_member_in_guild: z.boolean(),
    enforce_report_reason: z.boolean(),
})

export const MessageReportsConfigUpdateSchema = MessageReportsConfigSchema.partial()

export type MessageReportsConfig = z.infer<typeof MessageReportsConfigSchema>
export type MessageReportsConfigUpdate = z.infer<typeof MessageReportsConfigUpdateSchema>
