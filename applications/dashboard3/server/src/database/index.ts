import { Kysely } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import postgres from 'postgres'
import type { DashboardDB } from './types'
import { env } from '../config/env'

export class DatabaseInstance{
    private static instance: Kysely<DashboardDB> | undefined = undefined

    private constructor(){}

    public static getInstance(): Kysely<DashboardDB> {
        if (!this.instance) {
            this.instance = new Kysely<DashboardDB>({
                dialect: new PostgresJSDialect({ postgres: postgres(env.database.url) }),
            })
        }
        return this.instance
    }
}

export type { DashboardDB } from './types'
