import { Collection } from "discord.js";
import { prisma } from "#root/index.js";

import type {
	BanRequestConfig,
	HighlightConfig,
	MessageReportConfig,
	PermissionScope,
	QuickMuteConfig,
	QuickPurgeConfig
} from "#prisma/client.js";

import GuildConfig, { type GuildConfigData } from "#managers/config/GuildConfig.js";

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

	public static async getGuildConfig(guildId: string): Promise<GuildConfig> {
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

	public static async updateCachedConfig<T extends ConfigFeature>(
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
	 * Computes a config for the guild and stores it in the cache.
	 *
	 * ⚠️ This method performs a lot of batched database queries and isn't intended to be called frequently. Use the .get method to retrieve cached configs instead.
	 *
	 * @param guildId The ID of the guild.
	 * @returns The computed GuildConfig.
	 */

	private static async _compute(guildId: string): Promise<GuildConfig> {
		// Upsert a guild first or all subsequent upserts will fail due to foreign key constraints.

		await prisma.guild.upsert({
			where: { id: guildId },
			create: { id: guildId },
			update: {}
		});

		const [messageReports, banRequests, quickMutes, quickPurges, highlights, permissionScopes] =
			await prisma.$transaction([
				prisma.messageReportConfig.upsert({
					where: { id: guildId },
					create: { id: guildId },
					update: {}
				}),
				prisma.banRequestConfig.upsert({
					where: { id: guildId },
					create: { id: guildId },
					update: {}
				}),
				prisma.quickMuteConfig.upsert({
					where: { id: guildId },
					create: { id: guildId },
					include: { channel_scoping: true },
					update: {}
				}),
				prisma.quickPurgeConfig.upsert({
					where: { id: guildId },
					create: { id: guildId },
					include: { channel_scoping: true },
					update: {}
				}),
				prisma.highlightConfig.upsert({
					where: { id: guildId },
					create: { id: guildId },
					update: {}
				}),
				prisma.permissionScope.findMany({ where: { guild_id: guildId } })
			]);

		const data: GuildConfigData = {
			id: guildId,
			message_reports: messageReports,
			ban_requests: banRequests,
			quick_mutes: {
				...quickMutes,
				channel_scoping: quickMutes.channel_scoping
			},
			quick_purges: {
				...quickPurges,
				channel_scoping: quickPurges.channel_scoping
			},
			highlights: highlights,
			permission_scopes: permissionScopes
		};

		return new GuildConfig(data);
	}
}

/** Maping of feature keys. */
type ConfigFeatureMap = {
	message_reports: MessageReportConfig;
	ban_requests: BanRequestConfig;
	quick_mutes: QuickMuteConfig;
	quick_purges: QuickPurgeConfig;
	highlights: HighlightConfig;
	permission_scopes: PermissionScope[];
};

type ConfigFeature = keyof ConfigFeatureMap;

export const ConfigKeys = {
	MessageReports: "message_reports",
	BanRequests: "ban_requests",
	QuickMutes: "quick_mutes",
	QuickPurges: "quick_purges",
	Highlights: "highlights",
	PermissionScopes: "permission_scopes"
} as const;
