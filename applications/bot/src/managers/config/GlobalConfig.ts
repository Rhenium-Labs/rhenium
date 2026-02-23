import { fromError } from "zod-validation-error";

import ms from "ms";
import fs from "node:fs";

import { client, kysely } from "@root/index";
import { LOG_DATE_FORMAT } from "@utils/Constants";
import { inflect, readYamlFile, startCronJob } from "@utils/index";
import { GLOBAL_CONFIG_SCHEMA, RawGlobalConfig } from "./Schema";

import Logger from "@utils/Logger";
import ConfigManager from "./ConfigManager";
import MessageManager from "@database/Messages";

export default class GlobalConfig {
	/** Data representing the global configuration. */
	private static _data: RawGlobalConfig;

	/** Caches the global configuration data from the .yml file. */
	static async cache(): Promise<void> {
		Logger.info("Caching global configuration...");

		if (!fs.existsSync("cfg.global.yml")) {
			Logger.fatal("Global configuration file (cfg.global.yml) is missing.");
			process.exit(1);
		}

		const rawConfig = readYamlFile<RawGlobalConfig>("cfg.global.yml");
		const parseResult = GLOBAL_CONFIG_SCHEMA.safeParse(rawConfig);

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

	static isDeveloper(userId: string): boolean {
		return this._data.developers.includes(userId);
	}

	/** Starts the cron jobs responsible for managing messages in the database. */
	static startMessageRetentionCronJobs(): void {
		const { insert_cron, delete_cron, ttl } = this._data.database.messages;

		startCronJob({
			monitorSlug: "MESSAGE_INSERT_CRON",
			cronTime: insert_cron,
			onTick: async () => {
				await MessageManager.insert().catch(error => {
					Logger.error("Failed to insert messages into the database:", error);
				});
			}
		});

		startCronJob({
			monitorSlug: "MESSAGE_DELETE_CRON",
			cronTime: delete_cron,
			onTick: async () => {
				const createdAtThreshold = new Date(Date.now() - ttl);
				const createdAtStr = createdAtThreshold.toLocaleDateString(
					undefined,
					LOG_DATE_FORMAT
				);
				const durationStr = ms(ttl, { long: true });

				Logger.info(
					`Deleting messages created before ${createdAtStr} (older than ${durationStr})...`
				);

				const { numDeletedRows } = await kysely
					.deleteFrom("Message")
					.where("created_at", "<=", createdAtThreshold)
					.executeTakeFirst();

				if (numDeletedRows === 0n) {
					Logger.info("No messages were deleted.");
				} else {
					Logger.info(
						`Deleted ${numDeletedRows} ${inflect(Number(numDeletedRows), "message")} created before ${createdAtStr} (older than ${durationStr}).`
					);
				}
			}
		});
	}

	/** Starts the cron job for automatically disregarding message reports. */
	static startMessageReportDisregardCronJob(): void {
		const { disregard_cron } = this._data.database.reports;

		startCronJob({
			monitorSlug: "MESSAGE_REPORT_DISREGARD_CRON",
			cronTime: disregard_cron,
			onTick: async () => {
				const now = new Date();
				const guilds = await kysely
					.selectFrom("MessageReport")
					.select("guild_id")
					.where("status", "=", "Pending")
					.distinct()
					.execute();

				for (const { guild_id } of guilds) {
					const config = (await ConfigManager.get(guild_id)).parseReportsConfig();
					if (!config) continue;

					const autoDisregardAfter = BigInt(config.auto_disregard_after);
					if (autoDisregardAfter === 0n) continue; // Skip if auto-disregard is disabled for this guild.

					const threshold = new Date(now.getTime() - Number(autoDisregardAfter));

					const { numUpdatedRows } = await kysely
						.updateTable("MessageReport")
						.set({
							status: "Disregarded",
							resolved_at: now,
							resolved_by: client.user.id
						})
						.where("guild_id", "=", guild_id)
						.where("status", "=", "Pending")
						.where("reported_at", "<=", threshold)
						.executeTakeFirst();

					if (numUpdatedRows > 0n)
						Logger.info(
							`Automatically disregarded ${numUpdatedRows} message ${inflect(Number(numUpdatedRows), "report")} in guild with ID "${guild_id}".`
						);
				}
			}
		});
	}
}
