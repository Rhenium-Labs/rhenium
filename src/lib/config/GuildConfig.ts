import type { GuildMember } from "discord.js";

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
} from "#kysely/Schema.js";
import type { LoggingEvent, UserPermission } from "#kysely/Enums.js";

export default class GuildConfig {
	/**
	 * Data representing the guild configuration.
	 */

	public readonly data: GuildConfigData;

	/**
	 * Creates an instance of GuildConfig.
	 * @param data The guild configuration data.
	 */
	public constructor(data: GuildConfigData) {
		this.data = data;
	}

	/**
	 * Gets the report configuration for message reports.
	 *
	 * This method will return null if ANY the following conditions are met:
	 * - Message reports are disabled in the guild.
	 * - No report channels are configured.
	 *
	 * @return The message report configuration or null.
	 */
	public getMessageReportsConfig(): ValidatedMessageReportsConfig | null {
		if (!this.data.message_reports.enabled || !this.data.message_reports.webhook_url) {
			return null;
		}

		return this.data.message_reports as ValidatedMessageReportsConfig;
	}

	/**
	 * Gets the request configuration for ban requests.
	 *
	 * This method will return null if ANY the following conditions are met:
	 * - Ban requests are disabled in the guild.
	 * - No webhook URL is configured.
	 *
	 * @return The ban request configuration or null.
	 */
	public getBanRequestsConfig(): ValidatedBanRequestsConfig | null {
		if (!this.data.ban_requests.enabled || !this.data.ban_requests.webhook_url) {
			return null;
		}

		return this.data.ban_requests as ValidatedBanRequestsConfig;
	}

	/**
	 * Gets the quick mutes configuration.
	 *
	 * This method will return null if ANY the following conditions are met:
	 * - Quick mutes are disabled in the guild.
	 * - Quick mute webhook URL is not configured.
	 * - Quick mute result webhook URL is not configured.
	 *
	 * @return The quick mutes configuration or null.
	 */
	public getQuickMutesConfig(): ValidatedQuickMutesConfig | null {
		if (
			!this.data.quick_mutes.enabled ||
			!this.data.quick_mutes.webhook_url ||
			!this.data.quick_mutes.result_webhook_url
		) {
			return null;
		}

		return this.data.quick_mutes as ValidatedQuickMutesConfig;
	}

	/**
	 * Gets the quick purges configuration.
	 *
	 * This method will return null if ANY the following conditions are met:
	 * - Quick purges are disabled in the guild.
	 * - Quick purge webhook URL is not configured.
	 * - Quick purge result webhook URL is not configured.
	 */

	public getQuickPurgesConfig(): ValidatedQuickPurgesConfig | null {
		if (
			!this.data.quick_purges.enabled ||
			!this.data.quick_purges.webhook_url ||
			!this.data.quick_purges.result_webhook_url
		) {
			return null;
		}

		return this.data.quick_purges as ValidatedQuickPurgesConfig;
	}

	/**
	 * Gets the content filter configuration.
	 *
	 * This method will return null if ANY the following conditions are met:
	 * - Content filter is disabled in the guild.
	 * - No webhook URL is configured.
	 *
	 * @return The content filter configuration or null.
	 */
	public getContentFilterConfig(): ValidatedContentFilterConfig | null {
		if (!this.data.content_filter.enabled || !this.data.content_filter.webhook_url) {
			return null;
		}

		return this.data.content_filter as ValidatedContentFilterConfig;
	}

	/**
	 * Check if a member has a specific permission scope.
	 *
	 * @param member The guild member to check.
	 * @param permission The permission to check for.
	 * @returns True if the member has the permission scope, false otherwise.
	 */
	public hasPermission(member: GuildMember, permission: UserPermission): boolean {
		const scopes = this.data.permission_scopes;
		const scopesLen = scopes.length;

		for (let i = 0; i < scopesLen; i++) {
			const scope = scopes[i];

			if (
				member.roles.cache.has(scope.role_id) &&
				scope.allowed_permissions.includes(permission)
			) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check if a specific logging event can be logged.
	 *
	 * @param event The logging event to check.
	 * @returns True if the event can be logged, false otherwise.
	 */
	public canLogEvent(event: LoggingEvent): boolean {
		return this.data.logging_webhooks.some(wh => wh.events.includes(event));
	}
}

export type GuildConfigData = {
	id: string;
	message_reports: MessageReportConfig;
	ban_requests: BanRequestConfig;
	content_filter: ContentFilterConfig & { channel_scoping: ContentFilterChannelScoping[] };
	highlights: HighlightConfig;
	quick_mutes: QuickMuteConfig & { channel_scoping: QuickMuteChannelScoping[] };
	quick_purges: QuickPurgeConfig & { channel_scoping: QuickPurgeChannelScoping[] };
	permission_scopes: PermissionScope[];
	logging_webhooks: LoggingWebhook[];
};

// Validated Config Types
// These types represent configurations that have been validated to ensure
// all required fields for the feature to function are present.

export type ValidatedMessageReportsConfig = MessageReportConfig & {
	webhook_url: string;
};

export type ValidatedBanRequestsConfig = BanRequestConfig & {
	webhook_url: string;
	decision_webhook_url: string;
};

export type ValidatedContentFilterConfig = (ContentFilterConfig & {
	channel_scoping: ContentFilterChannelScoping[];
}) & {
	webhook_url: string;
};

export type ValidatedQuickMutesConfig = (QuickMuteConfig & {
	channel_scoping: QuickMuteChannelScoping[];
}) & {
	webhook_url: string;
	result_webhook_url: string;
};

export type ValidatedQuickPurgesConfig = (QuickPurgeConfig & {
	channel_scoping: QuickPurgeChannelScoping[];
}) & {
	webhook_url: string;
	result_webhook_url: string;
};
