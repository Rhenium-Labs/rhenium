import { Kysely } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import postgres from 'postgres'
import type { DashboardDB } from './types'
import { env } from '../utils/env'

let instance: Kysely<DashboardDB> | undefined

export function getDatabase(): Kysely<DashboardDB> {
    if (!instance) {
        instance = new Kysely<DashboardDB>({
            dialect: new PostgresJSDialect({ postgres: postgres(env.database.url) }),
        })
    }
    return instance
}

export type { DashboardDB } from './types'
