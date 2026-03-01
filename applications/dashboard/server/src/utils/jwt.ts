import * as jose from 'jose'
import { env } from './env'

export interface JwtPayload {
    sub: string
    username: string
    avatar: string | null
}

function getSecret(): Uint8Array {
    return new TextEncoder().encode(env.jwt.secret)
}

function parseExpiresIn(value: string): string {
    return value
}

export const jwt = {
    async sign(payload: JwtPayload): Promise<string> {
        return new jose.SignJWT(payload as unknown as jose.JWTPayload)
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime(parseExpiresIn(env.jwt.expiresIn))
            .sign(getSecret())
    },

    async verify(token: string): Promise<JwtPayload> {
        const { payload } = await jose.jwtVerify(token, getSecret())
        return {
            sub: payload.sub!,
            username: payload.username as string,
            avatar: (payload.avatar as string) ?? null,
        }
    },

    extractBearer(header: string | undefined): string | null {
        if (!header?.startsWith('Bearer ')) return null
        return header.slice(7)
    },
} as const
