import { createKyselyClient } from "@repo/db";
import { env } from "$lib/env";

/** Kysely database client instance for the dashboard. */
export const db = createKyselyClient(env.PG_URL);
