import {
	type GuildBan,
	type APIActionRowComponent,
	type APIButtonComponentWithCustomId,
	Colors,
	ComponentType,
	EmbedBuilder,
	Events,
	WebhookClient
} from "discord.js";

import ConfigManager from "#managers/config/ConfigManager.js";
import EventListener from "#managers/events/EventListener.js";

const CONCURRENCY_LIMIT = 3;

export default class GuildBanAdd extends EventListener {
	public constructor() {
		super(Events.GuildBanAdd);
	}

	public onEmit(ban: GuildBan) {
		return Promise.all([this._resolveReports(ban), this._resolveRequests(ban)]);
	}

	/**
	 * Automatically resolves any pending message reports against a user when they are banned.
	 *
	 * @param ban The GuildBan object representing the ban event.
	 * @returns A promise that resolves when the reports have been processed.
	 */

	private async _resolveReports(ban: GuildBan): Promise<void> {
		const config = await ConfigManager.getGuildConfig(ban.guild.id).then(c => c.getMessageReportsConfig());
		if (!config?.webhook_url || !config.log_webhook_url) return;

		const reports = await this.prisma.messageReport.findMany({
			where: { author_id: ban.user.id, guild_id: ban.guild.id, status: "Pending" },
			select: { id: true }
		});

		if (reports.length === 0) return;

		const reportIds = reports.map(r => r.id);
		const subWebhook = new WebhookClient({ url: config.webhook_url });
		const logWebhook = new WebhookClient({ url: config.log_webhook_url });

		try {
			await this.prisma.messageReport.updateMany({
				where: { id: { in: reportIds } },
				data: { resolved_by: this.client.user.id, resolved_at: new Date(), status: "Resolved" }
			});

			for (let i = 0; i < reportIds.length; i += CONCURRENCY_LIMIT) {
				const batch = reportIds.slice(i, i + CONCURRENCY_LIMIT);
				await Promise.allSettled(
					batch.map(async id => {
						const message = await subWebhook.fetchMessage(id).catch(() => null);
						if (!message) return;

						const actionRows = (message.components?.filter(c => c.type === ComponentType.ActionRow) ??
							[]) as APIActionRowComponent<APIButtonComponentWithCustomId>[];

						const hasRefEmbed = actionRows
							.flatMap(row => row.components)
							.some(btn => btn.custom_id?.startsWith("delete-reference-report-message"));

						const embedIndex = hasRefEmbed ? 1 : 0;
						const resolvedEmbed = new EmbedBuilder(message.embeds[embedIndex])
							.setAuthor({ name: "Message Report AutoResolved" })
							.setColor(Colors.Green)
							.setFooter({
								text: `Reviewed by @${this.client.user.username} (${this.client.user.id})`
							})
							.setTimestamp();

						const embeds = hasRefEmbed
							? [new EmbedBuilder(message.embeds[0]), resolvedEmbed]
							: [resolvedEmbed];

						return Promise.all([
							logWebhook.send({ embeds }).catch(() => null),
							subWebhook.deleteMessage(id).catch(() => null)
						]);
					})
				);
			}
		} finally {
			subWebhook.destroy();
			logWebhook.destroy();
		}
	}

	/**
	 * Automatically resolves any pending ban requests against a user when they are banned.
	 *
	 * @param ban The GuildBan object representing the ban event.
	 * @returns A promise that resolves when the requests have been processed.
	 */

	private async _resolveRequests(ban: GuildBan): Promise<void> {
		const config = await ConfigManager.getGuildConfig(ban.guild.id).then(c => c.getBanRequestsConfig());
		if (!config?.webhook_url || !config.log_webhook_url) return;

		const requests = await this.prisma.banRequest.findMany({
			where: { target_id: ban.user.id, guild_id: ban.guild.id, status: "Pending" },
			select: { id: true }
		});

		if (requests.length === 0) return;

		const requestIds = requests.map(r => r.id);
		const subWebhook = new WebhookClient({ url: config.webhook_url });
		const logWebhook = new WebhookClient({ url: config.log_webhook_url });

		try {
			await this.prisma.banRequest.updateMany({
				where: { id: { in: requestIds } },
				data: { resolved_by: this.client.user.id, resolved_at: new Date(), status: "AutoResolved" }
			});

			for (let i = 0; i < requestIds.length; i += CONCURRENCY_LIMIT) {
				const batch = requestIds.slice(i, i + CONCURRENCY_LIMIT);
				await Promise.allSettled(
					batch.map(async id => {
						const message = await subWebhook.fetchMessage(id).catch(() => null);
						if (!message) return;

						const resolvedEmbed = new EmbedBuilder(message.embeds[0])
							.setAuthor({ name: "Ban Request AutoResolved" })
							.setColor(Colors.Green)
							.setFooter({
								text: `Reviewed by @${this.client.user.username} (${this.client.user.id})`
							})
							.setTimestamp();

						return Promise.all([
							logWebhook.send({ embeds: [resolvedEmbed] }).catch(() => null),
							subWebhook.deleteMessage(id).catch(() => null)
						]);
					})
				);
			}
		} finally {
			subWebhook.destroy();
			logWebhook.destroy();
		}
	}
}
