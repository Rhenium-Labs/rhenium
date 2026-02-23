import { kysely } from "@root/index";
import { type Guild, type GuildAuditLogsEntry, AuditLogEvent, Events, Webhook } from "discord.js";

import ConfigManager from "@config/ConfigManager";
import EventListener from "@events/EventListener";

export default class GuildAuditLogEntryCreate extends EventListener {
	constructor() {
		super(Events.GuildAuditLogEntryCreate);
	}

	async execute(auditLog: GuildAuditLogsEntry, guild: Guild): Promise<unknown> {
		const { target, executorId, action } = auditLog;

		if (!executorId || executorId === this.client.user.id) return;
		if (!(target instanceof Webhook) || action !== AuditLogEvent.WebhookDelete) return;

		// If a webhook was deleted, check if it existed in our config.
		const config = await ConfigManager.get(guild.id);
		const hasWebhook = config.data.logging_webhooks.some(wh => wh.id === target.id);

		if (hasWebhook) {
			const updatedWebhooks = config.data.logging_webhooks.filter(
				wh => wh.id !== target.id
			);

			const updatedConfig = {
				...config.data,
				logging_webhooks: updatedWebhooks
			};

			await kysely
				.updateTable("Guild")
				.set({ config: updatedConfig })
				.where("id", "=", guild.id)
				.execute();
		}
	}
}
