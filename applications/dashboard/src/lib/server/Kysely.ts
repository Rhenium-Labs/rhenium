import { PG_URL } from "$env/static/private";
import { createKyselyClient } from "@repo/db";

/** Kysely database client instance for the dashboard. */
export const kysely = createKyselyClient(PG_URL);
