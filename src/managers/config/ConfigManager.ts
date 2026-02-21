import { Collection } from "discord.js";
import { kysely } from "#root/index.js";

import type {
	BanRequestConfig,
	ContentFilterChannelScoping,
	ContentFilterConfig,
	HighlightConfig,
	LoggingWebhook,
	MessageReportConfig,
	PermissionScope,
	QuickMuteChannelScoping,
	QuickMuteConfig,
	QuickPurgeChannelScoping,
	QuickPurgeConfig
} from "#database/Schema.js";

import GuildConfig, { type GuildConfigData } from "./GuildConfig.js";

export default class ConfigManager {
	/**
	 * Cache for all guild configurations.
	 */

	private static readonly _cache: Collection<string, GuildConfig> = new Collection();

	/**
	 * Retrieves a guild configuration from the cache, or computes it if not present.
	 *
	 * @param guildId The ID of the guild.
	 * @returns The GuildConfig for the specified guild.
	 */

	static async get(guildId: string): Promise<GuildConfig> {
		let config = ConfigManager._cache.get(guildId);

		if (!config) {
			config = await ConfigManager._compute(guildId);
			ConfigManager._cache.set(guildId, config);
		}

		return config;
	}

	/**
	 * Reloads a specific feature key in the cached configuration for a guild.
	 *
	 * @param guildId The ID of the guild.
	 * @param feature The feature key to reload (e.g., 'message_reports', 'ban_requests').
	 * @returns void
	 */
	static async reload(guildId: string, feature: ConfigFeature): Promise<void> {
		const config = ConfigManager._cache.get(guildId);
		if (!config) return;

		const featureData = await ConfigManager._getFeatureData(guildId, feature);
		const updatedData: GuildConfigData = {
			...config.data,
			[feature]: featureData
		};

		ConfigManager._cache.set(guildId, new GuildConfig(updatedData));

		// Update experimental `config` column in Guild table to keep it synced.
		return void kysely
			.updateTable("Guild")
			.set({ config: updatedData })
			.where("id", "=", guildId)
			.execute();
	}

	/**
	 * Fetches the data for a specific feature from the database.
	 *
	 * @param guildId The ID of the guild.
	 * @param feature The feature key to fetch.
	 * @returns The feature data.
	 */
	private static async _getFeatureData(
		guildId: string,
		feature: ConfigFeature
	): Promise<ConfigFeatureMap[ConfigFeature]> {
		switch (feature) {
			case "logging_webhooks":
				return kysely
					.selectFrom("LoggingWebhook")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute();

			case "permission_scopes":
				return kysely
					.selectFrom("PermissionScope")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute();

			case "message_reports":
			case "ban_requests":
			case "highlights":
			case "content_filter":
			case "quick_mutes":
			case "quick_purges":
				const { table, scopingTable } = FeatureTableMap[feature];

				const config = await kysely
					.selectFrom(table)
					.selectAll()
					.where("id", "=", guildId)
					.executeTakeFirst();

				if (!scopingTable) {
					return config as ConfigFeatureMap[ConfigFeature];
				}

				const scoping = await kysely
					.selectFrom(scopingTable)
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute();

				return {
					...config,
					channel_scoping: scoping
				} as ConfigFeatureMap[ConfigFeature];
		}
	}

	/**
	 * Computes a config for the guild and stores it in the cache.
	 *
	 * ⚠️ This method performs a lot of batched database queries and is meant to be called once per guild.
	 *
	 * @param guildId The ID of the guild.
	 * @returns The computed GuildConfig.
	 */

	private static async _compute(guildId: string): Promise<GuildConfig> {
		// Ensure the guild exists in the database.
		// All subsequent config inserts rely on this.
		await kysely
			.insertInto("Guild")
			.values({ id: guildId })
			.onConflict(oc => oc.column("id").doNothing())
			.execute();

		const [
			messageReports,
			banRequests,
			quickMutes,
			quickPurges,
			highlights,
			contentFilter,
			permissionScopes,
			quickMuteScoping,
			quickPurgeScoping,
			contentFilterScoping,
			loggingWebhooks
		] = await kysely.transaction().execute(async trx =>
			Promise.all([
				trx
					.insertInto("MessageReportConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirstOrThrow(),
				trx
					.insertInto("BanRequestConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirstOrThrow(),
				trx
					.insertInto("QuickMuteConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirstOrThrow(),
				trx
					.insertInto("QuickPurgeConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirstOrThrow(),
				trx
					.insertInto("HighlightConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirstOrThrow(),
				trx
					.insertInto("ContentFilterConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirstOrThrow(),
				trx
					.selectFrom("PermissionScope")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute(),
				trx
					.selectFrom("QuickMuteChannelScoping")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute(),
				trx
					.selectFrom("QuickPurgeChannelScoping")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute(),
				trx
					.selectFrom("ContentFilterChannelScoping")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute(),
				trx
					.selectFrom("LoggingWebhook")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute()
			])
		);

		const data: GuildConfigData = {
			id: guildId,
			message_reports: messageReports,
			ban_requests: banRequests,
			quick_mutes: {
				...quickMutes,
				channel_scoping: quickMuteScoping
			},
			quick_purges: {
				...quickPurges,
				channel_scoping: quickPurgeScoping
			},
			highlights: highlights,
			content_filter: {
				...contentFilter,
				channel_scoping: contentFilterScoping
			},
			permission_scopes: permissionScopes,
			logging_webhooks: loggingWebhooks
		};

		// 🔧 EXPERIMENTAL
		// The `config` column is meant to be a single source of truth for all guild configuration. It is crucial that this column is kept in sync with the individual config tables until the migration is complete and those tables are removed.

		await kysely
			.updateTable("Guild")
			.set({ config: data })
			.where("id", "=", guildId)
			.execute();

		return new GuildConfig(data);
	}
}

/** Mapping of feature keys to their main table and optional scoping table. */
const FeatureTableMap = {
	message_reports: { table: "MessageReportConfig", scopingTable: null },
	ban_requests: { table: "BanRequestConfig", scopingTable: null },
	quick_mutes: { table: "QuickMuteConfig", scopingTable: "QuickMuteChannelScoping" },
	quick_purges: { table: "QuickPurgeConfig", scopingTable: "QuickPurgeChannelScoping" },
	highlights: { table: "HighlightConfig", scopingTable: null },
	content_filter: { table: "ContentFilterConfig", scopingTable: "ContentFilterChannelScoping" }
} as const;

/** Mapping of feature keys to their types. */
type ConfigFeatureMap = {
	message_reports: MessageReportConfig;
	ban_requests: BanRequestConfig;
	quick_mutes: QuickMuteConfig & { channel_scoping: QuickMuteChannelScoping[] };
	quick_purges: QuickPurgeConfig & { channel_scoping: QuickPurgeChannelScoping[] };
	highlights: HighlightConfig;
	content_filter: ContentFilterConfig & { channel_scoping: ContentFilterChannelScoping[] };
	permission_scopes: PermissionScope[];
	logging_webhooks: LoggingWebhook[];
};

type ConfigFeature = keyof ConfigFeatureMap;

export const ConfigKeys = {
	MessageReports: "message_reports",
	BanRequests: "ban_requests",
	QuickMutes: "quick_mutes",
	QuickPurges: "quick_purges",
	Highlights: "highlights",
	ContentFilter: "content_filter",
	PermissionScopes: "permission_scopes",
	LoggingWebhooks: "logging_webhooks"
} as const;
export type ConfigKeys = (typeof ConfigKeys)[keyof typeof ConfigKeys];
