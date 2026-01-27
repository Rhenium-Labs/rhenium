import {
	Prisma,
	HighlightConfig,
	QuickMuteConfig,
	BanRequestConfig,
	ContentFilterConfig,
	MessageReportConfig
} from "#prisma/client.js";

import ConfigManager, { ConfigKeys } from "../config/ConfigManager.js";

/** Initializes the Prisma cache invalidator extension. */
export function initConfigCacheInvalidator() {
	return Prisma.defineExtension({
		name: "prisma-cache-invalidator",
		query: {
			$allModels: {
				async update({ args, model, query }) {
					const result = await query(args);

					if (CachedModel.includes(model)) {
						const key = ModelToConfigKeys[model]!;
						const typedResult = result as KeyToReturnType[typeof key];

						if (typedResult?.id) {
							void ConfigManager.update(typedResult.id, key, typedResult);
						}
					}

					if (ChannelScopingModels.includes(model)) {
						const typedResult = result as { guild_id: string };
						const configKey = ChannelScopingToConfigKey[model];

						if (typedResult?.guild_id && configKey) {
							void ConfigManager.computeSingle(typedResult.guild_id, configKey);
						}
					}

					return result;
				},

				async create({ args, model, query }) {
					const result = await query(args);

					// Handle channel scoping creates
					if (ChannelScopingModels.includes(model)) {
						const typedResult = result as { guild_id: string };
						const configKey = ChannelScopingToConfigKey[model];

						if (typedResult?.guild_id && configKey) {
							void ConfigManager.computeSingle(typedResult.guild_id, configKey);
						}
					}

					return result;
				},

				async delete({ args, model, query }) {
					// For deletes, we need to extract guild_id before the deletion
					let guildId: string | null = null;
					let configKey: ConfigKeys | undefined;

					if (ChannelScopingModels.includes(model)) {
						const where = args.where as { guild_id_channel_id?: { guild_id: string } };
						guildId = where?.guild_id_channel_id?.guild_id ?? null;
						configKey = ChannelScopingToConfigKey[model];
					}

					const result = await query(args);

					if (ChannelScopingModels.includes(model) && guildId && configKey) {
						void ConfigManager.computeSingle(guildId, configKey);
					}

					return result;
				},

				async deleteMany({ args, model, query }) {
					// For deleteMany, extract guild_id from the where clause
					let guildId: string | null = null;
					let configKey: ConfigKeys | undefined;

					if (ChannelScopingModels.includes(model)) {
						const where = args.where as { guild_id?: string } | undefined;
						guildId = where?.guild_id ?? null;
						configKey = ChannelScopingToConfigKey[model];
					}

					const result = await query(args);

					if (ChannelScopingModels.includes(model) && guildId && configKey) {
						void ConfigManager.computeSingle(guildId, configKey);
					}

					return result;
				}
			}
		}
	});
}

/** Main config models that use `id` as the guild ID */
const CachedModel: readonly Prisma.ModelName[] = [
	"MessageReportConfig",
	"BanRequestConfig",
	"QuickMuteConfig",
	"QuickPurgeConfig",
	"ContentFilterConfig",
	"HighlightConfig"
] as const;

/** Channel scoping models that use `guild_id` */
const ChannelScopingModels: readonly Prisma.ModelName[] = [
	"QuickMuteChannelScoping",
	"QuickPurgeChannelScoping",
	"ContentFilterChannelScoping"
] as const;

/** Maps channel scoping models to their parent config key */
const ChannelScopingToConfigKey: Partial<Record<Prisma.ModelName, ConfigKeys>> = {
	QuickMuteChannelScoping: ConfigKeys.QuickMutes,
	QuickPurgeChannelScoping: ConfigKeys.QuickPurges,
	ContentFilterChannelScoping: ConfigKeys.ContentFilter
} as const;

const ModelToConfigKeys: Partial<Record<Prisma.ModelName, Exclude<ConfigKeys, "permission_scopes">>> = {
	MessageReportConfig: ConfigKeys.MessageReports,
	BanRequestConfig: ConfigKeys.BanRequests,
	QuickMuteConfig: ConfigKeys.QuickMutes,
	QuickPurgeConfig: ConfigKeys.QuickPurges,
	ContentFilterConfig: ConfigKeys.ContentFilter,
	HighlightConfig: ConfigKeys.Highlights
} as const;

type KeyToReturnType = {
	[ConfigKeys.MessageReports]: MessageReportConfig | null;
	[ConfigKeys.BanRequests]: BanRequestConfig | null;
	[ConfigKeys.QuickMutes]: QuickMuteConfig | null;
	[ConfigKeys.QuickPurges]: QuickMuteConfig | null;
	[ConfigKeys.ContentFilter]: ContentFilterConfig | null;
	[ConfigKeys.Highlights]: HighlightConfig | null;
};
