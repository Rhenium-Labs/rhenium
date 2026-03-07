import * as jose from 'jose'
import * as z from 'zod'
import { env } from '../config/env'
import { JWT } from '../constants'

export interface JwtGuild {
    id: string
    name: string
    icon: string | null
    whitelisted: boolean
    bot_in_guild: boolean
}

export interface JwtPayload {
    sub: string
    username: string
    avatar: string | null
    guilds?: JwtGuild[]
}

export interface AuthUser {
    id: string
    username: string
    avatar: string | null
    guilds: JwtGuild[]
}

const jwtGuildSchema = z.object({
    id: z.string(),
    name: z.string(),
    icon: z.string().nullable(),
    whitelisted: z.boolean(),
    bot_in_guild: z.boolean(),
})

const jwtPayloadSchema = z.object({
    sub: z.string(),
    username: z.string(),
    avatar: z.string().nullable(),
    guilds: z.array(jwtGuildSchema).optional().default([]),
})

function getSecret(): Uint8Array {
    return new TextEncoder().encode(env.jwt.secret)
}

export const jwtService = {
    async sign(payload: JwtPayload): Promise<string> {
        const claims: jose.JWTPayload = {
            sub: payload.sub,
            username: payload.username,
            avatar: payload.avatar,
            guilds: payload.guilds,
        }
        return new jose.SignJWT(claims)
            .setProtectedHeader({ alg: JWT.ALGORITHM })
            .setIssuedAt()
            .setExpirationTime(env.jwt.expiresIn)
            .sign(getSecret())
    },

    async verify(token: string): Promise<JwtPayload> {
        const { payload } = await jose.jwtVerify(token, getSecret())
        return jwtPayloadSchema.parse(payload)
    },

    extractBearer(header: string | undefined): string | null {
        if (!header?.startsWith(JWT.BEARER_PREFIX)) return null
        return header.slice(JWT.BEARER_PREFIX.length)
    },
} as const
