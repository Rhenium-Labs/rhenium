import { z } from "zod";

/** Zod regex schema for validating cron expressions. */
// Format: "*/5 * * * *" (every 5 minutes)
const zCronRegex = z
	.string()
	.regex(
		/^(@(annually|yearly|monthly|weekly|daily|hourly|reboot))|(@every (\d+(ns|us|µs|ms|s|m|h))+)|((((\d+,)+\d+|([\d*]+[/-]\d+)|\d+|\*) ?){5,7})$/gm
	);

export const GLOBAL_CONFIG_SCHEMA = z.object({
	developers: z.array(z.string()).default([]),
	database: z.object({
		messages: z.object({
			insert_cron: zCronRegex,
			delete_cron: zCronRegex,
			ttl: z.number().min(1000).default(604800000) // 7 days in milliseconds
		}),
		reports: z.object({
			disregard_cron: zCronRegex
		})
	})
});

export type RawGlobalConfig = z.infer<typeof GLOBAL_CONFIG_SCHEMA>;
