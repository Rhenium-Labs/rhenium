import type { Context as HonoContext } from 'hono'
import { jwtService, type AuthUser } from './jwt'

export type { AuthUser }

export interface AppContext {
    user: AuthUser | null
    [key: string]: unknown
}

export async function createContext(c: HonoContext): Promise<AppContext> {
    const token = jwtService.extractBearer(c.req.header('Authorization'))
    const user = await resolveUser(token)
    return { user }
}

async function resolveUser(token: string | null): Promise<AuthUser | null> {
    if (!token) return null
    try {
        const payload = await jwtService.verify(token)
        return {
            id: payload.sub,
            username: payload.username,
            avatar: payload.avatar,
            guilds: payload.guilds ?? [],
        }
    } catch {
        return null
    }
}
