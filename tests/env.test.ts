import { fromError } from "zod-validation-error";
import { envZodSchema } from "../src/env";
import { describe, test } from "node:test";

describe("Environment Variables Validation", () => {
	test(".env", async () => {
		return envZodSchema.safeParseAsync(process.env).then(result => {
			if (!result.success) {
				const validationError = fromError(result.error);
				throw new Error(validationError.toString());
			}
		});
	});
});
