import { fromError } from "zod-validation-error";
import { describe, test } from "bun:test";
import { z } from "zod";

describe("Environment Variables Validation", () => {
	test(".env", async () => {
		const envSchema = z.object({
			BOT_TOKEN: z.string(),
			PG_URL: z
				.string()
				.regex(
					/^(postgres(?:ql)?:\/\/)([^:@\/\s]+)(?::([^@\/\s]*))?@([^:\/\s]+)(?::(\d+))?\/([^?\s]+)(\?.*)?$/,
					{ error: "Invalid PostgreSQL connection URL" }
				)
		});

		return envSchema.safeParseAsync(process.env).then(result => {
			if (!result.success) {
				const validationError = fromError(result.error);
				throw new Error(validationError.toString());
			}
		});
	});
});
