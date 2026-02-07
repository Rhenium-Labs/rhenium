import { captureException } from "@sentry/node";
import {
	type GuildBan,
	type GuildTextBasedChannel,
	Colors,
	EmbedBuilder,
	Events,
	messageLink
} from "discord.js";

import ms from "ms";

import { LoggingEvent } from "#database/Enums.js";
import { client, kysely } from "#root/index.js";
import { formatMessageContent } from "#utils/Messages.js";
import { EMPTY_MESSAGE_CONTENT } from "#utils/Constants.js";
import { cropLines, userMentionWithId, log } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import GuildConfig from "#config/GuildConfig.js";
import ConfigManager from "#config/ConfigManager.js";
import EventListener from "#events/EventListener.js";
import MessageManager from "#database/Messages.js";

export default class GuildBanAdd extends EventListener {
	constructor() {
		super(Events.GuildBanAdd);
	}

	async execute(ban: GuildBan) {
		const config = await ConfigManager.get(ban.guild.id);

		try {
			await Promise.all([
				GuildBanAdd._resolvePendingReports(ban, config),
				GuildBanAdd._resolvePendingBanRequests(ban, config)
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

			return Logger.traceable(
				sentryId,
				`Failed cleanup operations for @${ban.user.username} (${ban.user.id}).`
			);
		}
	}

	private static async _resolvePendingReports(
		ban: GuildBan,
		config: GuildConfig
	): Promise<void> {
		if (
			!config.parseReportsConfig() ||
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

		for (const report of reports) {
			const additionalReporters =
				report.additional_reporters.length > 0
					? report.additional_reporters.map(id => userMentionWithId(id)).join("\n")
					: "";

			const embeds: EmbedBuilder[] = [];

			const croppedContent = cropLines(report.content ?? EMPTY_MESSAGE_CONTENT, 5);
			const formattedContent = await formatMessageContent({
				url: report.message_url,
				content: croppedContent,
				stickerId: null,
				includeUrl: true,
				createdAt: report.reported_at
			});

			const primaryEmbed = new EmbedBuilder()
				.setAuthor({ name: "Message Report AutoResolved" })
				.setColor(Colors.Green)
				.setThumbnail(ban.user.displayAvatarURL())
				.setFields([
					{
						name: "Reported By",
						value: `${userMentionWithId(report.reported_by)}${additionalReporters}`
					},
					{
						name: "Report Reason",
						value: report.report_reason
					},
					{
						name: "Message Author",
						value: userMentionWithId(ban.user.id)
					},
					{
						name: "Message Content",
						value: formattedContent
					}
				])
				.setFooter({ text: `Reviewed by @${client.user.username} (${client.user.id})` })
				.setTimestamp();

			embeds.push(primaryEmbed);

			const reference =
				report.reference_id && (await MessageManager.get(report.reference_id));

			if (reference) {
				const croppedContent = cropLines(reference.content ?? EMPTY_MESSAGE_CONTENT, 5);
				const url = messageLink(reference.channel_id, reference.id, reference.guild_id);

				const formattedReferenceContent = await formatMessageContent({
					url,
					content: croppedContent,
					stickerId: reference.sticker_id,
					createdAt: reference.created_at
				});

				const referenceEmbed = new EmbedBuilder()
					.setAuthor({ name: "Message Reference" })
					.setColor(Colors.NotQuiteBlack)
					.setFields([
						{
							name: "Reference Author",
							value: userMentionWithId(reference.author_id)
						},
						{
							name: "Reference Content",
							value: formattedReferenceContent
						}
					])
					.setTimestamp();

				embeds.push(referenceEmbed);
			}

			void log({
				event: LoggingEvent.MessageReportReviewed,
				config,
				message: { embeds }
			});
		}

		if (!config.data.message_reports.webhook_channel) return;

		const reportsChannel = (await client.channels
			.fetch(config.data.message_reports.webhook_channel)
			.catch(() => null)) as GuildTextBasedChannel | null;

		if (!reportsChannel) return;

		// prettier-ignore
		void reportsChannel
			.bulkDelete(reports.map(r => r.id), true)
			.catch(() => null);
	}

	private static async _resolvePendingBanRequests(
		ban: GuildBan,
		config: GuildConfig
	): Promise<void> {
		if (
			!config.parseBanRequestsConfig() ||
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

		for (const request of requests) {
			const embed = new EmbedBuilder()
				.setColor(Colors.Green)
				.setAuthor({ name: "Ban Request AutoResolved" })
				.setThumbnail(ban.user.displayAvatarURL())
				.setFields([
					{ name: "Target", value: userMentionWithId(ban.user.id) },
					{ name: "Requested By", value: userMentionWithId(request.requested_by) },
					{ name: "Reason", value: request.reason },
					{ name: "Reviewer Reason", value: "Resolved automatically from user ban." }
				])
				.setFooter({ text: `Reviewed by @${client.user.username} (${client.user.id})` })
				.setTimestamp();

			if (request.duration) {
				embed.spliceFields(2, 0, {
					name: "Duration",
					value: ms(Number(request.duration), { long: true })
				});
			}

			void log({
				event: LoggingEvent.BanRequestReviewed,
				config,
				message: { embeds: [embed] }
			});
		}

		if (!config.data.ban_requests.webhook_channel) return;

		const requestsChannel = (await client.channels
			.fetch(config.data.ban_requests.webhook_channel)
			.catch(() => null)) as GuildTextBasedChannel | null;

		if (!requestsChannel) return;

		// prettier-ignore
		void requestsChannel
			.bulkDelete(requests.map(r => r.id), true)
			.catch(() => null);
	}
}
