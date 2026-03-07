import { z } from "zod";

const envSchema = z.object({
	VITE_API_URL: z.string().url(),
});

const parsed = envSchema.safeParse({
	VITE_API_URL: import.meta.env.VITE_API_URL,
});

if (!parsed.success) {
	throw new Error(
		`Invalid environment variables: ${parsed.error.message}. Ensure .env has valid VITE_API_URL if set.`
	);
}

export const env = parsed.data;
