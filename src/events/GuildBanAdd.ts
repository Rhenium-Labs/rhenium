import { captureException } from "@sentry/node";
import {
	type GuildBan,
	Colors,
	EmbedBuilder,
	Events,
	GuildTextBasedChannel,
	WebhookClient
} from "discord.js";

import { log } from "#utils/Webhooks.js";
import { LoggingEvent } from "#kysely/Enums.js";
import { client, kysely } from "#root/index.js";
import { ApplyOptions, EventListener } from "#rhenium";

import ConfigManager from "#root/lib/config/ConfigManager.js";
import GuildConfig from "#root/lib/config/GuildConfig.js";
import Logger from "#utils/Logger.js";

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

			return Logger.tracable(
				sentryId,
				`Failed cleanup operations for @${ban.user.username} (${ban.user.id}).`
			);
		}
	}

	private static async _clearMessageReports(ban: GuildBan, config: GuildConfig): Promise<void> {
		if (
			!config.getMessageReportsConfig() ||
			!config.canLogEvent(LoggingEvent.MessageReportReviewed)
		)
			return;

		const reports = await kysely
			.updateTable("MessageReport")
			.set({
				resolved_by: client.user.id,
				resolved_at: new Date(),
				status: "AutoResolved"
			})
			.where("author_id", "=", ban.user.id)
			.where("guild_id", "=", ban.guild.id)
			.where("status", "=", "Pending")
			.returningAll()
			.execute();

		if (reports.length === 0) return;

		const reportSubmissions: string[] = [];
		const webhook = new WebhookClient({ url: config.data.message_reports.webhook_url! });

		let reportChannelId!: string;

		for (const report of reports) {
			const message = await webhook.fetchMessage(report.id).catch(() => null);
			if (!message) continue;

			const embedIdx = message.embeds.length > 1 ? 1 : 0;
			const currentEmbed = message.embeds.at(embedIdx);

			if (!currentEmbed) continue;

			const primaryEmbed = new EmbedBuilder(currentEmbed)
				.setAuthor({ name: "Message Report Automatically Resolved" })
				.setColor(Colors.Green)
				.setFooter({
					text: `Reviewed by @${client.user.username} (${client.user.id})`
				})
				.setTimestamp();

			const secondaryEmbed = embedIdx === 1 ? message.embeds.at(0) : undefined;

			reportSubmissions.push(message.id);
			reportChannelId = message.channel_id;

			void log({
				event: LoggingEvent.MessageReportReviewed,
				guildId: ban.guild.id,
				message: {
					embeds: secondaryEmbed ? [secondaryEmbed, primaryEmbed] : [primaryEmbed]
				}
			});
		}

		const reportChannel = (await client.channels
			.fetch(reportChannelId)
			.catch(() => null)) as GuildTextBasedChannel | null;

		// If the channel somehow doesn't exist anymore, just return.
		if (!reportChannel) return;

		// prettier-ignore
		return void reportChannel
			.bulkDelete(reportSubmissions, true)
			.catch(() => null);
	}

	private static async _clearBanRequests(ban: GuildBan, config: GuildConfig): Promise<void> {
		if (
			!config.getBanRequestsConfig() ||
			!config.canLogEvent(LoggingEvent.BanRequestReviewed)
		)
			return;

		const requests = await kysely
			.updateTable("BanRequest")
			.set({
				resolved_by: client.user.id,
				resolved_at: new Date(),
				status: "AutoResolved"
			})
			.where("target_id", "=", ban.user.id)
			.where("guild_id", "=", ban.guild.id)
			.where("status", "=", "Pending")
			.returningAll()
			.execute();

		if (requests.length === 0) return;

		const requestSubmissions: string[] = [];
		const webhook = new WebhookClient({ url: config.data.ban_requests.webhook_url! });

		let requestChannelId!: string;

		for (const request of requests) {
			const message = await webhook.fetchMessage(request.id).catch(() => null);
			if (!message) continue;

			const resolvedEmbed = new EmbedBuilder(message.embeds[0])
				.setAuthor({ name: "Ban Request Automatically Resolved" })
				.setColor(Colors.Green)
				.setFooter({
					text: `Reviewed by @${client.user.username} (${client.user.id})`
				})
				.setTimestamp();

			requestSubmissions.push(message.id);
			requestChannelId = message.channel_id;

			void log({
				event: LoggingEvent.BanRequestReviewed,
				guildId: ban.guild.id,
				message: { embeds: [resolvedEmbed] }
			});
		}

		const requestChannel = (await client.channels
			.fetch(requestChannelId)
			.catch(() => null)) as GuildTextBasedChannel | null;

		// If the channel somehow doesn't exist anymore, just return.
		if (!requestChannel) return;

		// prettier-ignore
		return void requestChannel
			.bulkDelete(requestSubmissions, true)
			.catch(() => null);
	}
}
