import { fromZodError } from "zod-validation-error";
import { kysely } from "#root/index.js";

import { DEFAULT_GUILD_CONFIG, GUILD_CONFIG_SCHEMA } from "@repo/config";

import GuildConfig from "./GuildConfig.js";
import Logger from "#utils/Logger.js";

export default class ConfigManager {
	/** Cached guild configurations. */
	private static readonly _cache: Map<string, GuildConfig> = new Map();

	/**
	 * Retrieves a guild configuration from the cache, or computes it if not present.
	 *
	 * @param guildId The ID of the guild.
	 * @returns The GuildConfig for the specified guild.
	 */

	static async getGuildConfig(guildId: string): Promise<GuildConfig> {
		let config = ConfigManager._cache.get(guildId);

		if (!config) {
			config = await ConfigManager._compute(guildId);
			ConfigManager._cache.set(guildId, config);
		}

		return config;
	}

	/**
	 * Reloads a guild's configuration from the database and updates the cache.
	 *
	 * @param guildId The ID of the guild to reload the configuration for.
	 * @returns A promise that resolves when the configuration has been reloaded.
	 */
	static async reload(guildId: string): Promise<void> {
		const config = ConfigManager._cache.get(guildId);
		if (!config) return;

		const guild = await kysely
			.selectFrom("Guild")
			.select(["config"])
			.where("id", "=", guildId)
			.executeTakeFirstOrThrow();

		const parseResult = GUILD_CONFIG_SCHEMA.safeParse(guild.config);

		if (!parseResult.success) {
			const error = fromZodError(parseResult.error);
			Logger.error(`Failed to parse config for guild "${guildId}": ${error.toString()}`);

			// Use the default configuration if parsing fails.
			ConfigManager._cache.set(guildId, new GuildConfig(guildId, DEFAULT_GUILD_CONFIG));
		} else {
			ConfigManager._cache.set(guildId, new GuildConfig(guildId, parseResult.data));
		}
	}

	/**
	 * Computes a guild configuration by fetching it from the database or creating a default if it doesn't exist.
	 *
	 * @param guildId The ID of the guild to compute the configuration for.
	 * @returns The computed GuildConfig instance.
	 */

	private static async _compute(guildId: string): Promise<GuildConfig> {
		let guild = await kysely
			.selectFrom("Guild")
			.select(["config"])
			.where("id", "=", guildId)
			.executeTakeFirst();

		if (!guild) {
			guild = await kysely
				.insertInto("Guild")
				.values({ id: guildId, config: DEFAULT_GUILD_CONFIG })
				.returning(["config"])
				.executeTakeFirstOrThrow();
		}

		const parseResult = GUILD_CONFIG_SCHEMA.safeParse(guild.config);

		if (!parseResult.success) {
			const error = fromZodError(parseResult.error);
			Logger.error(`Failed to parse config for guild "${guildId}": ${error.toString()}`);

			return new GuildConfig(guildId, DEFAULT_GUILD_CONFIG);
		}

		return new GuildConfig(guildId, parseResult.data);
	}
}
