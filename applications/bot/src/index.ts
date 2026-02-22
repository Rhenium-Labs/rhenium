import { createKyselyClient } from "@repo/db";

export const kysely = createKyselyClient("postgresql://user:password@host:port/database");
console.log("Kysely client created successfully.");
