import { kysely } from "#root/index.js";
import { type Guild, type GuildAuditLogsEntry, AuditLogEvent, Events, Webhook } from "discord.js";

import ConfigManager from "#config/ConfigManager.js";
import EventListener from "#managers/events/EventListener.js";

export default class GuildAuditLogEntryCreate extends EventListener {
	constructor() {
		super(Events.GuildAuditLogEntryCreate);
	}

	async execute(auditLog: GuildAuditLogsEntry, guild: Guild): Promise<void> {
		const { target, executorId, action } = auditLog;

		if (!executorId || executorId === this.client.user.id) return;
		if (!(target instanceof Webhook) || action !== AuditLogEvent.WebhookDelete) return;

		// If a webhook was deleted, check if it existed in our config.
		const config = await ConfigManager.get(guild.id);
		const hasWebhook = config.data.logging_webhooks.some(wh => wh.id === target.id);

		if (hasWebhook) {
			// Guild ID is provided to trigger a refresh of the cached logging webhooks.
			// This is necessary because the cache invalidator looks for "guild_id" to determine what to invalidate.
			return void kysely
				.deleteFrom("LoggingWebhook")
				.where("id", "=", target.id)
				.where("guild_id", "=", guild.id)
				.executeTakeFirst();
		}
	}
}
