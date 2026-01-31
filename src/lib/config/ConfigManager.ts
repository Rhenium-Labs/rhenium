import { Collection } from "discord.js";
import { kysely } from "#root/index.js";

import type {
	BanRequestConfig,
	ContentFilterChannelScoping,
	ContentFilterConfig,
	HighlightConfig,
	MessageReportConfig,
	PermissionScope,
	QuickMuteChannelScoping,
	QuickMuteConfig,
	QuickPurgeChannelScoping,
	QuickPurgeConfig
} from "#kysely/Schema.js";

import GuildConfig, { type GuildConfigData } from "./GuildConfig.js";

export default class ConfigManager {
	/**
	 * Cache for all guild configurations.
	 */

	private static _cache: Collection<string, GuildConfig> = new Collection();

	/**
	 * Retrieves a guild configuration from the cache, or computes it if not present.
	 *
	 * @param guildId The ID of the guild.
	 * @returns The GuildConfig for the specified guild.
	 */

	public static async get(guildId: string): Promise<GuildConfig> {
		let config = this._cache.get(guildId);

		if (!config) {
			config = await this._compute(guildId);
			this._cache.set(guildId, config);
		}

		return config;
	}

	/**
	 * Updates the cached configuration for a guild by providing the updated entry for a specific feature.
	 *
	 * @param guildId The ID of the guild.
	 * @param feature The feature key to update (e.g., 'message_reports', 'ban_requests').
	 * @param data The partial configuration data to merge into the specified feature.
	 * @returns void
	 */

	public static async update<T extends ConfigFeature>(
		guildId: string,
		feature: T,
		data: Partial<ConfigFeatureMap[T]>
	): Promise<void> {
		const config = this._cache.get(guildId);

		if (!config) {
			return;
		}

		// Merge the existing feature data with the new data.
		// Arrays are replaced entirely, while objects are merged.
		const newFeatureData = Array.isArray(data)
			? data
			: {
					...config.data[feature],
					...data
				};

		const updatedData: GuildConfigData = {
			...config.data,
			[feature]: newFeatureData
		};

		this._cache.set(guildId, new GuildConfig(updatedData));
	}

	/**
	 * Invalidates a specific feature key in the cached configuration for a guild.
	 *
	 * @param guildId The ID of the guild.
	 * @param feature The feature key to invalidate (e.g., 'message_reports', 'ban_requests').
	 * @returns void
	 */
	public static async invalidateKey(guildId: string, feature: ConfigFeature): Promise<void> {
		const config = this._cache.get(guildId);

		if (!config) {
			return;
		}

		let featureData: ConfigFeatureMap[ConfigFeature];

		switch (feature) {
			case "message_reports":
				featureData = (await kysely
					.insertInto("MessageReportConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirst()) as MessageReportConfig;
				break;

			case "ban_requests":
				featureData = (await kysely
					.insertInto("BanRequestConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirst()) as BanRequestConfig;
				break;

			case "quick_mutes": {
				const result = (await kysely
					.insertInto("QuickMuteConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirst()) as QuickMuteConfig;

				const scoping = await kysely
					.selectFrom("QuickMuteChannelScoping")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute();

				featureData = { ...result, channel_scoping: scoping };
				break;
			}

			case "quick_purges": {
				const result = (await kysely
					.insertInto("QuickPurgeConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirst()) as QuickPurgeConfig;

				const scoping = await kysely
					.selectFrom("QuickPurgeChannelScoping")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute();

				featureData = { ...result, channel_scoping: scoping };
				break;
			}

			case "highlights":
				featureData = (await kysely
					.insertInto("HighlightConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirst()) as HighlightConfig;

				break;

			case "content_filter": {
				const result = (await kysely
					.insertInto("ContentFilterConfig")
					.values({ id: guildId })
					.onConflict(oc => oc.column("id").doUpdateSet({ id: guildId }))
					.returningAll()
					.executeTakeFirst()) as ContentFilterConfig;

				const scoping = await kysely
					.selectFrom("ContentFilterChannelScoping")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute();

				featureData = { ...result, channel_scoping: scoping };
				break;
			}

			case "permission_scopes":
				featureData = await kysely
					.selectFrom("PermissionScope")
					.selectAll()
					.where("guild_id", "=", guildId)
					.execute();

				break;
		}

		const updatedData: GuildConfigData = {
			...config.data,
			[feature]: featureData
		};

		this._cache.set(guildId, new GuildConfig(updatedData));
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
			contentFilterScoping
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
				trx.selectFrom("PermissionScope").selectAll().where("guild_id", "=", guildId).execute(),
				trx.selectFrom("QuickMuteChannelScoping").selectAll().where("guild_id", "=", guildId).execute(),
				trx.selectFrom("QuickPurgeChannelScoping").selectAll().where("guild_id", "=", guildId).execute(),
				trx.selectFrom("ContentFilterChannelScoping").selectAll().where("guild_id", "=", guildId).execute()
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
			permission_scopes: permissionScopes
		};

		return new GuildConfig(data);
	}
}

/** Maping of feature keys. */
type ConfigFeatureMap = {
	message_reports: MessageReportConfig;
	ban_requests: BanRequestConfig;
	quick_mutes: QuickMuteConfig & { channel_scoping: QuickMuteChannelScoping[] };
	quick_purges: QuickPurgeConfig & { channel_scoping: QuickPurgeChannelScoping[] };
	highlights: HighlightConfig;
	content_filter: ContentFilterConfig & { channel_scoping: ContentFilterChannelScoping[] };
	permission_scopes: PermissionScope[];
};

type ConfigFeature = keyof ConfigFeatureMap;

export const ConfigKeys = {
	MessageReports: "message_reports",
	BanRequests: "ban_requests",
	QuickMutes: "quick_mutes",
	QuickPurges: "quick_purges",
	Highlights: "highlights",
	ContentFilter: "content_filter",
	PermissionScopes: "permission_scopes"
} as const;
export type ConfigKeys = (typeof ConfigKeys)[keyof typeof ConfigKeys];
