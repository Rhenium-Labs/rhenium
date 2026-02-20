import {
	WebhookClient,
	type APIMessage,
	type GuildMember,
	type WebhookMessageCreateOptions
} from "discord.js";
import { captureException } from "@sentry/node";

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
import { LoggingEvent, UserPermission } from "#database/Enums.js";

import Logger from "#utils/Logger.js";

export default class GuildConfig {
	/**
	 * Data representing the guild configuration.
	 */

	readonly data: GuildConfigData;

	/**
	 * Constructs a new GuildConfig instance.
	 *
	 * @param data The guild configuration data.
	 * @return The constructed GuildConfig instance.
	 */
	constructor(data: GuildConfigData) {
		this.data = data;
	}

	/**
	 * Parse the message reports configuration.
	 * All the following checks must pass to return a valid configuration:
	 *
	 * - Message reports must be enabled.
	 * - A webhook URL must be set.
	 *
	 * @returns The parsed message reports configuration, or null if not configured.
	 */

	parseReportsConfig() {
		if (!this.data.message_reports.enabled || !this.data.message_reports.webhook_url)
			return null;

		return {
			...this.data.message_reports,
			webhook_url: this.data.message_reports.webhook_url
		};
	}

	/**
	 * Parse the ban requests configuration.
	 * All the following checks must pass to return a valid configuration:
	 *
	 * - Ban requests must be enabled.
	 * - A webhook URL must be set.
	 *
	 * @returns The parsed ban requests configuration, or null if not configured.
	 */

	parseBanRequestsConfig() {
		if (!this.data.ban_requests.enabled || !this.data.ban_requests.webhook_url) return null;

		return {
			...this.data.ban_requests,
			webhook_url: this.data.ban_requests.webhook_url
		};
	}

	/**
	 * Parse quick action configuration (quick mutes or quick purges).
	 * All the following checks must pass to return a valid configuration:
	 *
	 * - The quick action must be enabled.
	 * - The primary logging event must be loggable.
	 * - The result logging event must be loggable.
	 *
	 * @param type The type of quick action to parse ("quick_mutes" or "quick_purges").
	 * @returns The parsed quick action configuration, or null if not configured.
	 */

	parseQuickActionConfig<T extends "quick_mutes" | "quick_purges">(type: T) {
		const config = this.data[type];
		const primaryEvent =
			type === "quick_mutes"
				? LoggingEvent.QuickMuteExecuted
				: LoggingEvent.QuickPurgeExecuted;
		const resultEvent =
			type === "quick_mutes"
				? LoggingEvent.QuickMuteResult
				: LoggingEvent.QuickPurgeResult;

		if (!config.enabled || !this.canLogEvent(primaryEvent) || !this.canLogEvent(resultEvent))
			return null;

		return config;
	}

	/**
	 * Parse the content filter configuration.
	 * All the following checks must pass to return a valid configuration:
	 *
	 * - Content filter must be enabled.
	 * - A webhook URL must be set.
	 *
	 * @returns The parsed content filter configuration, or null if not configured.
	 */

	parseContentFilterConfig() {
		if (!this.data.content_filter.enabled || !this.data.content_filter.webhook_url)
			return null;

		return {
			...this.data.content_filter,
			webhook_url: this.data.content_filter.webhook_url
		};
	}

	/**
	 * Check if a member has a specific permission scope.
	 *
	 * @param member The guild member to check.
	 * @param permission The permission to check for.
	 * @returns True if the member has the permission scope, false otherwise.
	 */
	hasPermission(member: GuildMember, permission: UserPermission): boolean {
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
	canLogEvent(event: LoggingEvent): boolean {
		return this.data.logging_webhooks.some(wh => wh.events.includes(event));
	}

	/**
	 * Send a log message to all webhooks configured for a specific event.
	 *
	 * @param event The logging event to send.
	 * @param payload The message payload to send to the webhooks.
	 * @returns The sent messages, or null if no webhooks are configured for the event.
	 */

	async log(
		event: LoggingEvent,
		payload: WebhookMessageCreateOptions
	): Promise<APIMessage[] | null> {
		const webhooks = this.data.logging_webhooks.filter(webhook =>
			webhook.events.includes(event)
		);

		if (webhooks.length === 0) return null;

		try {
			const clients = webhooks.map(webhook => new WebhookClient({ url: webhook.url }));
			return await Promise.all(
				clients.map(client => client.send(payload).finally(() => client.destroy()))
			);
		} catch (error) {
			const sentryId = captureException(error, {
				extra: { guildId: this.data.id, event, payload }
			});

			Logger.traceable(
				sentryId,
				`Failed to log event "${event}" for guild "${this.data.id}".`
			);
			return null;
		}
	}
}

/** The guild configuration data structure. */
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

/**
 * Parsed content filter configuration with channel scoping and webhook URL.
 * Unlike the other types, we export this one because spidermat's content filtering
 * module needs to use it.
 */
export type ParsedContentFilterConfig = ContentFilterConfig & {
	channel_scoping: ContentFilterChannelScoping[];
	webhook_url: string;
};
