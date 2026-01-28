import { captureException } from "@sentry/node";
import {
	type APIActionRowComponent,
	type APIButtonComponentWithCustomId,
	Colors,
	ComponentType,
	EmbedBuilder,
	Events,
	GuildBan,
	WebhookClient
} from "discord.js";

import { client, prisma } from "#root/index.js";
import { ApplyOptions, EventListener } from "#rhenium";

import ConfigManager from "#root/lib/config/ConfigManager.js";
import GuildConfig from "#root/lib/config/GuildConfig.js";
import Logger from "#utils/Logger.js";

const CONCURRENCY_LIMIT = 3;

@ApplyOptions<EventListener.Options>({
	event: Events.GuildBanAdd
})
export default class GuildBanAdd extends EventListener {
	public async onEmit(ban: GuildBan) {
		const config = await ConfigManager.get(ban.guild.id);

		try {
			await Promise.all([
				GuildBanAdd._clearMessageReports(ban, config),
				GuildBanAdd._clearBanRequests(ban, config)
			]);
		} catch (error) {
			const sentryId = captureException(error, {
				user: {
					username: ban.user.username,
					id: ban.user.id
				},
				extra: {
					guild_id: ban.guild.id
				}
			});

			Logger.tracable(sentryId, `Failed cleanup operations for @${ban.user.username} (${ban.user.id}).`);
		}
	}

	private static async _clearMessageReports(ban: GuildBan, config: GuildConfig): Promise<void> {
		if (!config?.data.message_reports.webhook_url || !config.data.message_reports.log_webhook_url) return;

		const reports = await prisma.messageReport.updateManyAndReturn({
			where: { author_id: ban.user.id, guild_id: ban.guild.id, status: "Pending" },
			data: { resolved_by: client.user.id, resolved_at: new Date(), status: "AutoResolved" }
		});

		if (reports.length === 0) return;

		const reportIds = reports.map(r => r.id);

		const [primaryWebhook, secondaryWebhook] = [
			new WebhookClient({ url: config.data.message_reports.webhook_url }),
			new WebhookClient({ url: config.data.message_reports.log_webhook_url })
		];

		for (let i = 0; i < reportIds.length; i += CONCURRENCY_LIMIT) {
			const batch = reportIds.slice(i, i + CONCURRENCY_LIMIT);
			await Promise.allSettled(
				batch.map(async id => {
					const message = await primaryWebhook.fetchMessage(id).catch(() => null);
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
							text: `Reviewed by @${client.user.username} (${client.user.id})`
						})
						.setTimestamp();

					const embeds = hasRefEmbed
						? [new EmbedBuilder(message.embeds[0]), resolvedEmbed]
						: [resolvedEmbed];

					return Promise.all([
						secondaryWebhook.send({ embeds }).catch(() => null),
						primaryWebhook.deleteMessage(id).catch(() => null)
					]).then(() => {
						primaryWebhook.destroy();
						secondaryWebhook.destroy();
					});
				})
			);
		}
	}

	private static async _clearBanRequests(ban: GuildBan, config: GuildConfig): Promise<void> {
		if (!config?.data.ban_requests.webhook_url || !config.data.ban_requests.log_webhook_url) return;

		const requests = await prisma.banRequest.updateManyAndReturn({
			where: { target_id: ban.user.id, guild_id: ban.guild.id, status: "Pending" },
			data: { resolved_by: client.user.id, resolved_at: new Date(), status: "AutoResolved" }
		});

		if (requests.length === 0) return;

		const requestIds = requests.map(r => r.id);

		const [primaryWebhook, secondaryWebhook] = [
			new WebhookClient({ url: config.data.ban_requests.webhook_url }),
			new WebhookClient({ url: config.data.ban_requests.log_webhook_url })
		];

		for (let i = 0; i < requestIds.length; i += CONCURRENCY_LIMIT) {
			const batch = requestIds.slice(i, i + CONCURRENCY_LIMIT);
			await Promise.allSettled(
				batch.map(async id => {
					const message = await primaryWebhook.fetchMessage(id).catch(() => null);
					if (!message) return;

					const resolvedEmbed = new EmbedBuilder(message.embeds[0])
						.setAuthor({ name: "Ban Request AutoResolved" })
						.setColor(Colors.Green)
						.setFooter({
							text: `Reviewed by @${client.user.username} (${client.user.id})`
						})
						.setTimestamp();

					return Promise.all([
						secondaryWebhook.send({ embeds: [resolvedEmbed] }).catch(() => null),
						primaryWebhook.deleteMessage(id).catch(() => null)
					]).then(() => {
						primaryWebhook.destroy();
						secondaryWebhook.destroy();
					});
				})
			);
		}
	}
}
