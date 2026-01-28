import { z } from "zod";
import { fromError } from "zod-validation-error";

import ms from "ms";
import fs from "node:fs";

import { MessageQueue } from "#utils/Messages.js";
import { client, prisma } from "#root/index.js";
import { LOG_DATE_FORMAT, ZOD_CRON_REGEX } from "#utils/Constants.js";
import { inflect, readYamlFile, startCronJob } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import ConfigManager from "./ConfigManager.js";

export default class GlobalConfig {
	/** Data representing the global configuration. */
	private static _data: z.infer<typeof GlobalConfig._schema>;

	/** Schema for validating the global configuration. */
	private static _schema = z.object({
		developers: z.array(z.string()).default([]),
		database: z.object({
			messages: z.object({
				insert_cron: ZOD_CRON_REGEX,
				delete_cron: ZOD_CRON_REGEX,
				ttl: z.number().min(1000).default(604800000) // 7 days in milliseconds
			}),
			reports: z.object({
				disregard_cron: ZOD_CRON_REGEX
			})
		})
	});

	/** Caches the global configuration data from the .yml file. */
	public static async cache(): Promise<void> {
		Logger.info("Caching global configuration...");

		if (!fs.existsSync("cfg.global.yml")) {
			Logger.fatal("Global configuration file (cfg.global.yml) is missing.");
			process.exit(1);
		}

		const rawConfig = readYamlFile<z.infer<typeof GlobalConfig._schema>>("cfg.global.yml");
		const parseResult = this._schema.safeParse(rawConfig);

		if (!parseResult.success) {
			const error = fromError(parseResult.error);
			Logger.custom("GLOBAL_CONFIG", error.toString(), { color: "Red" });
			process.exit(1);
		}

		this._data = parseResult.data;
		Logger.success("Successfully cached global configuration.");
	}

	/**
	 * Checks if a user ID is included in the list of developer IDs.
	 *
	 * @param userId The user ID to check.
	 * @returns True if the user ID is a developer, false otherwise.
	 */

	public static isDeveloper(userId: string): boolean {
		return this._data.developers.includes(userId);
	}

	/** Starts the cron jobs responsible for managing messages in the database. */
	public static startMessageRetentionCronJobs(): void {
		const { insert_cron, delete_cron, ttl } = this._data.database.messages;

		startCronJob({
			monitorSlug: "MESSAGE_INSERT_CRON",
			cronTime: insert_cron,
			onTick: async () => {
				await MessageQueue.store().catch(error => {
					Logger.error("Failed to insert messages into the database:", error);
				});
			}
		});

		startCronJob({
			monitorSlug: "MESSAGE_DELETE_CRON",
			cronTime: delete_cron,
			onTick: async () => {
				const createdAtThreshold = new Date(Date.now() - ttl);
				const createdAtStr = createdAtThreshold.toLocaleDateString(undefined, LOG_DATE_FORMAT);
				const durationStr = ms(ttl, { long: true });

				Logger.info(`Deleting messages created before ${createdAtStr} (older than ${durationStr})...`);

				const { count } = await prisma.message.deleteMany({
					where: { created_at: { lte: createdAtThreshold } }
				});

				if (count === 0) {
					Logger.info("No messages were deleted.");
				} else {
					Logger.info(
						`Deleted ${count} ${inflect(count, "message")} created before ${createdAtStr} (older than ${durationStr}).`
					);
				}
			}
		});
	}

	/** Starts the cron job for automatically disregarding message reports. */
	public static startMessageReportDisregardCronJob(): void {
		const { disregard_cron } = this._data.database.reports;

		startCronJob({
			monitorSlug: "MESSAGE_REPORT_DISREGARD_CRON",
			cronTime: disregard_cron,
			onTick: async () => {
				const now = new Date();
				const guilds = await prisma.messageReport.findMany({
					where: { status: "Pending" },
					select: { guild_id: true },
					distinct: ["guild_id"]
				});

				for (const { guild_id } of guilds) {
					const config = (await ConfigManager.get(guild_id)).getMessageReportsConfig();
					if (!config || config.auto_disregard_after <= 0) continue;

					const threshold = new Date(now.getTime() - Number(config.auto_disregard_after));

					const { count } = await prisma.messageReport.updateMany({
						where: {
							guild_id,
							status: "Pending",
							reported_at: { lte: threshold }
						},
						data: {
							status: "Disregarded",
							resolved_at: now,
							resolved_by: client.user.id
						}
					});

					if (count > 0) {
						Logger.info(
							`Automatically disregarded ${count} message ${inflect(count, "report")} in guild with ID "${guild_id}".`
						);
					}
				}
			}
		});
	}
}
