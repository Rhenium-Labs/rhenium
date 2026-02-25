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

import { LoggingEvent } from "@repo/config";
import { client, kysely } from "@root/index";
import { formatMessageContent } from "@utils/Messages";
import { EMPTY_MESSAGE_CONTENT } from "@utils/Constants";
import { cropLines, userMentionWithId } from "@utils/index";

import Logger from "@utils/Logger";
import GuildConfig from "@config/GuildConfig";
import ConfigManager from "@config/ConfigManager";
import EventListener from "@events/EventListener";
import MessageManager from "@database/Messages";

export default class GuildBanAdd extends EventListener {
	constructor() {
		super(Events.GuildBanAdd);
	}

	async execute(ban: GuildBan) {
		const config = await ConfigManager.getGuildConfig(ban.guild.id);

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

	/**
	 * Resolves pending message reports for a banned user by marking them as resolved and logging the action.
	 *
	 * @param ban The GuildBan object representing the ban event.
	 * @param config The GuildConfig object for the guild where the ban occurred.
	 * @returns A promise that resolves when the operation is complete.
	 */
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

		// Build all report embeds in parallel.
		const embedPromises = reports.map(async report => {
			const additionalReporters =
				report.additional_reporters.length > 0
					? report.additional_reporters.map(id => userMentionWithId(id)).join("\n")
					: "";

			const embeds: EmbedBuilder[] = [];

			const croppedContent = cropLines(report.content ?? EMPTY_MESSAGE_CONTENT, 5);

			// Fetch formatted content and reference in parallel.
			const [formattedContent, reference] = await Promise.all([
				formatMessageContent({
					url: report.message_url,
					content: croppedContent,
					stickerId: null,
					includeUrl: true,
					createdAt: report.reported_at
				}),
				report.reference_id ? MessageManager.get(report.reference_id) : null
			]);

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

			return embeds;
		});

		const allEmbeds = await Promise.all(embedPromises);

		// Log all reports in parallel.
		await Promise.all(
			allEmbeds.map(embeds => config.log(LoggingEvent.MessageReportReviewed, { embeds }))
		);

		if (!config.data.message_reports.webhook_channel) return;

		const reportsChannel = (await client.channels
			.fetch(config.data.message_reports.webhook_channel)
			.catch(() => null)) as GuildTextBasedChannel | null;

		if (!reportsChannel) return;

		// prettier-ignore
		await reportsChannel
			.bulkDelete(reports.map(r => r.id), true)
			.catch(() => null);
	}

	/**
	 * Resolves pending ban requests for a banned user by marking them as resolved and logging the action.
	 *
	 * @param ban The GuildBan object representing the ban event.
	 * @param config The GuildConfig object for the guild where the ban occurred.
	 * @returns A promise that resolves when the operation is complete.
	 */
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

		// Build embeds and log all resolved requests in parallel.
		await Promise.all(
			requests.map(request => {
				const embed = new EmbedBuilder()
					.setColor(Colors.Green)
					.setAuthor({ name: "Ban Request AutoResolved" })
					.setThumbnail(ban.user.displayAvatarURL())
					.setFields([
						{ name: "Target", value: userMentionWithId(ban.user.id) },
						{
							name: "Requested By",
							value: userMentionWithId(request.requested_by)
						},
						{ name: "Reason", value: request.reason },
						{
							name: "Reviewer Reason",
							value: "Resolved automatically from user ban."
						}
					])
					.setFooter({
						text: `Reviewed by @${client.user.username} (${client.user.id})`
					})
					.setTimestamp();

				if (request.expires_at) {
					const duration =
						request.expires_at.getTime() - request.requested_at.getTime();

					embed.spliceFields(2, 0, {
						name: "Duration",
						value: ms(duration, { long: true })
					});
				}

				return config.log(LoggingEvent.BanRequestReviewed, { embeds: [embed] });
			})
		);

		if (!config.data.ban_requests.webhook_channel) return;

		const requestsChannel = (await client.channels
			.fetch(config.data.ban_requests.webhook_channel)
			.catch(() => null)) as GuildTextBasedChannel | null;

		if (!requestsChannel) return;

		// prettier-ignore
		await requestsChannel
			.bulkDelete(requests.map(r => r.id), true)
			.catch(() => null);
	}
}
