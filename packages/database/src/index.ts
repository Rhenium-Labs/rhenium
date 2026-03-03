import { Kysely, type KyselyPlugin } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";

import type { DB } from "./Schema.js";

import postgres from "postgres";

export * from "./Enums.js";
export * from "./Schema.js";

/**
 * Creates a Kysely client for the database.
 *
 * @param url The connection URL for the PostgreSQL database.
 * @param plugins Optional array of Kysely plugins to enhance the client's functionality.
 * @returns A Kysely client instance configured to interact with the specified PostgreSQL database.
 */

export function createKyselyClient(url: string, plugins: KyselyPlugin[] = []): Kysely<DB> {
	return new Kysely<DB>({
		dialect: new PostgresJSDialect({ postgres: postgres(url) }),
		plugins
	});
}
