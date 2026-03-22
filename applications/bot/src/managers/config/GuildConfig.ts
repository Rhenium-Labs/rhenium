import {
	WebhookClient,
	type APIMessage,
	type GuildMember,
	type WebhookMessageCreateOptions
} from "discord.js";
import { captureException, metrics } from "@sentry/node";

import Logger from "#utils/Logger.js";

import {
	ContentFilterConfig,
	LoggingEvent,
	RawGuildConfig,
	UserPermission,
	RawChannelScoping
} from "@repo/config";
import { Result } from "@sapphire/result";
import { SENTRY_METRICS_COUNTERS } from "#utils/Constants.js";

export default class GuildConfig {
	/**
	 * Data representing the guild configuration.
	 */

	readonly data: RawGuildConfig;

	/**
	 * ID of the guild this configuration belongs to.
	 */
	readonly id: string;

	/**
	 * Cached webhook clients keyed by webhook URL.
	 */
	private readonly _webhookClients: Map<string, WebhookClient> = new Map();

	/**
	 * Constructs a new GuildConfig instance.
	 *
	 * @param id The ID of the guild.
	 * @param data The guild configuration data.
	 * @return The constructed GuildConfig instance.
	 */
	constructor(id: string, data: RawGuildConfig) {
		this.id = id;
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

		const result = await Result.fromAsync(() => {
			const clients = webhooks.map(webhook => {
				let wc = this._webhookClients.get(webhook.url);

				if (!wc) {
					wc = new WebhookClient({ url: webhook.url });
					this._webhookClients.set(webhook.url, wc);
				}

				return wc;
			});

			return Promise.all(clients.map(wc => wc.send(payload)));
		});

		if (result.isErr()) {
			const error = result.unwrapErr();
			const sentryId = captureException(error, {
				extra: { guildId: this.id, event, payload }
			});

			Logger.traceable(
				sentryId,
				`Unable to send log for event "${event}" in guild "${this.id}":`,
				error
			);
			return null;
		}

		const messages = result.unwrap();

		metrics.count(SENTRY_METRICS_COUNTERS.ActionLogged, messages.length, {
			attributes: {
				guild_id: this.id,
				event
			}
		});

		return messages;
	}
}

/**
 * Parsed content filter configuration with channel scoping and webhook URL.
 * Unlike the other types, we export this one because spidermat's content filtering
 * module needs to use it.
 */
export type ParsedContentFilterConfig = ContentFilterConfig & {
	channel_scoping: RawChannelScoping[];
	webhook_url: string;
};
