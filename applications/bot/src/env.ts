import { z } from "zod";

/** Zod schema for validating environment variables. */
export const zEnvSchema = z.object({
	BOT_TOKEN: z.string(),
	PG_URL: z
		.string()
		.regex(
			/^(postgres(?:ql)?:\/\/)([^:@\/\s]+)(?::([^@\/\s]*))?@([^:\/\s]+)(?::(\d+))?\/([^?\s]+)(\?.*)?$/,
			{
				error: "Invalid PostgreSQL connection URL"
			}
		),
	SENTRY_DSN: z.string(),
	OPENAI_API_KEY: z.string(),
	TRPC_SECRET: z.string().min(32, "TRPC_SECRET must be at least 32 characters"),
	TRPC_PORT: z.string().regex(/^\d+$/).optional().default("3001"),
	DASHBOARD_ORIGIN: z.string().url().optional().default("http://localhost:5173")
});

/** Trigger validation when the module is loaded. */
zEnvSchema.parse(process.env);

/** Augment NodeJS.ProcessEnv with validated environment variables. */
declare global {
	namespace NodeJS {
		interface ProcessEnv extends z.infer<typeof zEnvSchema> {}
	}
}
