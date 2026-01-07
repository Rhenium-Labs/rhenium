import type { GuildMember } from "discord.js";

import type {
	BanRequestConfig,
	HighlightConfig,
	MessageReportConfig,
	PermissionScope,
	QuickMuteChannelScoping,
	QuickMuteConfig,
	QuickPurgeChannelScoping,
	QuickPurgeConfig,
	UserPermission
} from "#prisma/client.js";

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
	public getMessageReportsConfig(): MessageReportConfig | null {
		if (!this.data.message_reports.enabled || !this.data.message_reports.webhook_url) {
			return null;
		}

		return this.data.message_reports;
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
	public getBanRequestsConfig(): BanRequestConfig | null {
		if (!this.data.ban_requests.enabled || !this.data.ban_requests.webhook_url) {
			return null;
		}

		return this.data.ban_requests;
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
	public getQuickMutesConfig():
		| ((QuickMuteConfig & { channel_scoping: QuickMuteChannelScoping[] }) & {
				webhook_url: string;
				result_webhook_url: string;
		  })
		| null {
		if (
			!this.data.quick_mutes.enabled ||
			!this.data.quick_mutes.webhook_url ||
			!this.data.quick_mutes.result_webhook_url
		) {
			return null;
		}

		return this.data.quick_mutes as (QuickMuteConfig & { channel_scoping: QuickMuteChannelScoping[] }) & {
			webhook_url: string;
			result_webhook_url: string;
		};
	}

	/**
	 * Gets the quick purges configuration.
	 *
	 * This method will return null if ANY the following conditions are met:
	 * - Quick purges are disabled in the guild.
	 * - Quick purge webhook URL is not configured.
	 * - Quick purge result webhook URL is not configured.
	 */

	public getQuickPurgesConfig():
		| ((QuickPurgeConfig & { channel_scoping: QuickPurgeChannelScoping[] }) & {
				webhook_url: string;
				result_webhook_url: string;
		  })
		| null {
		if (
			!this.data.quick_purges.enabled ||
			!this.data.quick_purges.webhook_url ||
			!this.data.quick_purges.result_webhook_url
		) {
			return null;
		}

		return this.data.quick_purges as (QuickPurgeConfig & { channel_scoping: QuickPurgeChannelScoping[] }) & {
			webhook_url: string;
			result_webhook_url: string;
		};
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

			if (member.roles.cache.has(scope.role_id) && scope.allowed_permissions.includes(permission)) {
				return true;
			}
		}

		return false;
	}
}

export type GuildConfigData = {
	id: string;
	message_reports: MessageReportConfig;
	ban_requests: BanRequestConfig;
	highlights: HighlightConfig;
	quick_mutes: QuickMuteConfig & { channel_scoping: QuickMuteChannelScoping[] };
	quick_purges: QuickPurgeConfig & { channel_scoping: QuickPurgeChannelScoping[] };
	permission_scopes: PermissionScope[];
};
