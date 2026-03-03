import { PG_URL } from "$env/static/private";
import { createKyselyClient } from "@repo/db";

// What is goingo on with git.

/** Kysely database client instance for the dashboard. */
export const kysely = createKyselyClient(PG_URL);
