import { z } from 'zod'
import { snowflake } from './common'
import { LoggingEvent } from '@repo/config'

export const LoggingWebhookCreateSchema = z.object({
    channel_id: snowflake,
    events: z.array(z.enum(LoggingEvent)).min(1),
})

export const LoggingWebhookUpdateSchema = z.object({
    events: z.array(z.enum(LoggingEvent)).min(1),
})

export type LoggingWebhookCreate = z.infer<typeof LoggingWebhookCreateSchema>
export type LoggingWebhookUpdate = z.infer<typeof LoggingWebhookUpdateSchema>
