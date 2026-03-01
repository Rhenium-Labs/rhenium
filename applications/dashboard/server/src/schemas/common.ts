import * as z from 'zod'
import { DISCORD } from '../constants'

export const snowflake = z.string().regex(/^\d{17,20}$/)

export const snowflakeArray = z.array(snowflake)

export const webhookUrl = z
    .string()
    .regex(DISCORD.WEBHOOK_URL_PATTERN)
    .nullable()

export const guildIdParam = z.object({
    guildId: snowflake,
})

export const channelIdParam = z.object({
    channelId: snowflake,
})

export const guildAndChannelParams = guildIdParam.merge(channelIdParam)
