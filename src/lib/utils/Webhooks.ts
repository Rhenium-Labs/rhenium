import { APIMessage, WebhookClient, type WebhookMessageCreateOptions } from "discord.js";
import { captureException } from "@sentry/node";

import { kysely } from "#root/index.js";
import { LoggingEvent } from "#kysely/Enums.js";
import type { LoggingWebhook } from "#kysely/Schema.js";

import Logger from "./Logger.js";
import ConfigManager from "#config/ConfigManager.js";

export default class WebhookUtils {
	/**
	 * Gets a specific logging webhook by ID.
	 *
	 * @param webhookId The ID of the webhook.
	 * @param guildId The ID of the guild.
	 * @returns The LoggingWebhook record, or undefined if not found.
	 */
	static async get(webhookId: string, guildId: string): Promise<LoggingWebhook | undefined> {
		const config = await ConfigManager.get(guildId);
		return config.data.logging_webhooks.find(wh => wh.id === webhookId);
	}

	/**
	 * Gets the webhooks for a specified guild and/or event.
	 *
	 * @param guildId The ID of the guild.
	 * @param event The logging event type (optional).
	 * @returns An array of LoggingWebhook records.
	 */

	static async getWebhooks(guildId: string, event?: LoggingEvent): Promise<LoggingWebhook[]> {
		const config = await ConfigManager.get(guildId);
		const webhooks = config.data.logging_webhooks;

		return event ? webhooks.filter(webhook => webhook.events.includes(event)) : webhooks;
	}

	/**
	 * Adds events to an existing logging webhook.
	 *
	 * @param webhookId The ID of the webhook.
	 * @param guildId The ID of the guild.
	 * @param events The events to add.
	 * @returns The updated LoggingWebhook record, or null if not found.
	 */
	static async addEvents(
		webhookId: string,
		guildId: string,
		events: LoggingEvent[]
	): Promise<LoggingWebhook | null> {
		const webhook = await kysely
			.selectFrom("LoggingWebhook")
			.selectAll()
			.where("id", "=", webhookId)
			.where("guild_id", "=", guildId)
			.executeTakeFirst();

		if (!webhook) {
			return null;
		}

		const uniqueEvents = [...new Set([...webhook.events, ...events])];

		return kysely
			.updateTable("LoggingWebhook")
			.set({ events: uniqueEvents })
			.where("id", "=", webhookId)
			.where("guild_id", "=", guildId)
			.returningAll()
			.executeTakeFirstOrThrow();
	}

	/**
	 * Removes events from an existing logging webhook.
	 *
	 * @param webhookId The ID of the webhook.
	 * @param guildId The ID of the guild.
	 * @param events The events to remove.
	 * @returns The updated LoggingWebhook record, or null if not found.
	 */
	static async removeEvents(
		webhookId: string,
		guildId: string,
		events: LoggingEvent[]
	): Promise<LoggingWebhook | null> {
		const webhook = await kysely
			.selectFrom("LoggingWebhook")
			.selectAll()
			.where("id", "=", webhookId)
			.where("guild_id", "=", guildId)
			.executeTakeFirst();

		if (!webhook) {
			return null;
		}

		const remainingEvents = webhook.events.filter(e => !events.includes(e));

		return kysely
			.updateTable("LoggingWebhook")
			.set({ events: remainingEvents })
			.where("id", "=", webhookId)
			.where("guild_id", "=", guildId)
			.returningAll()
			.executeTakeFirstOrThrow();
	}
}

/**
 * Sends a log message to all webhooks configured for the specified event.
 *
 * @param data The log data.
 * @returns The sent messages or null.
 */
export async function log(data: {
	event: LoggingEvent;
	guildId: string;
	message: WebhookMessageCreateOptions;
}): Promise<APIMessage[] | null> {
	const { event, guildId, message } = data;

	const webhooks = await WebhookUtils.getWebhooks(guildId, event);
	if (!webhooks.length) return null;

	try {
		const webhookClients = webhooks.map(webhook => new WebhookClient({ url: webhook.url }));
		return Promise.all(
			webhookClients.map(client => client.send(message).finally(() => client.destroy()))
		);
	} catch (error) {
		const sentryId = captureException(error, {
			extra: { event, guildId, message }
		});

		Logger.tracable(sentryId, `Failed to log event "${event}" for guild "${guildId}".`);
		return null;
	}
}
