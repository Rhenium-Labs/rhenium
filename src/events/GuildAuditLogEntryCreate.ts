import { type Guild, type GuildAuditLogsEntry, AuditLogEvent, Events, Webhook } from "discord.js";
import { ApplyOptions, EventListener } from "#rhenium";

import ConfigManager from "#config/ConfigManager.js";

@ApplyOptions<EventListener.Options>({
	event: Events.GuildAuditLogEntryCreate
})
export default class GuildAuditLogEntryCreate extends EventListener {
	async onEmit(auditLog: GuildAuditLogsEntry, guild: Guild): Promise<void> {
		const { target, executorId, action } = auditLog;

		if (!executorId || executorId === this.client.user.id) return;
		if (!(target instanceof Webhook) || action !== AuditLogEvent.WebhookDelete) return;

		// If a webhook was deleted, check if it existed in our config and reload if so.
		const config = await ConfigManager.get(guild.id);
		const exists = config.data.logging_webhooks.some(wh => wh.url === target.url);

		if (exists) {
			void ConfigManager.reload(guild.id, "logging_webhooks");
		}
	}
}
