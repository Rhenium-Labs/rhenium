import type { Kysely } from 'kysely'
import type { DashboardDB } from '../database/types'

export interface AuthUser {
    id: string
    username: string
    avatar: string | null
}

export interface Context {
    [key: string]: unknown
    db: Kysely<DashboardDB>
    user: AuthUser | null
    isDeveloper: boolean
}
