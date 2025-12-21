import { z } from "zod";

/**
 * Zod schema for validating environment variables.
 */

export const envZodSchema = z.object({
	BOT_TOKEN: z.string(),
	PG_URL: z
		.string()
		.regex(/^(postgres(?:ql)?:\/\/)([^:@\/\s]+)(?::([^@\/\s]*))?@([^:\/\s]+)(?::(\d+))?\/([^?\s]+)(\?.*)?$/, {
			error: "Invalid PostgreSQL connection URL"
		})
});

/**
 * Module augmentation to extend process.env with validated environment variables.
 */

declare global {
	namespace NodeJS {
		interface ProcessEnv extends z.infer<typeof envZodSchema> {}
	}
}
