import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
	schema: "packages/database/prisma/schema.prisma",
	migrations: { path: "packages/database/prisma/migrations" },
	datasource: { url: env("PG_URL") }
});
