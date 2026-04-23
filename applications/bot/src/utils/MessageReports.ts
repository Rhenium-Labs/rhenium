import {
	type ButtonInteraction,
	type ColorResolvable,
	type Message,
	type GuildMember,
	type User,
	type EmbedField,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	escapeCodeBlock,
	messageLink,
	roleMention,
	time,
	WebhookClient,
	APIMessage
} from "discord.js";
import { metrics } from "@sentry/node";

import { ReportStatus } from "@repo/db";
import { client, kysely } from "#root/index.js";
import { LoggingEvent, UserPermission } from "@repo/config";
import { cleanContent, formatMessageContent } from "./Messages.js";
import { cropLines, truncate, userMentionWithId } from "./index.js";
import { EMPTY_MESSAGE_CONTENT, SENTRY_METRICS_COUNTERS } from "./Constants.js";

import type { SimpleResult } from "./Types.js";
import type { ResponseData } from "#commands/Command.js";
import type { MessageReport } from "@repo/db";

import GuildConfig from "#config/GuildConfig.js";

export default class MessageReportUtils {
	/**
	 * Upsert a message report.
	 *
	 * This method will create a new report if one doesn't already exist,
	 * or update an existing pending report if found.
	 *
	 * @param reporter The reporter.
	 * @param message The reported message.
	 * @param config The guild configuration.
	 * @param reason The reason for the report.
	 * @returns The result of the operation.
	 */

	static async upsert(
		reporter: User,
		message: Message<true>,
		config: GuildConfig,
		reason: string | null = null
	): Promise<SimpleResult> {
		const messageReports = config.data.message_reports;
		const targetMember = message.guild.members.cache.get(message.author.id) ?? null;

		const immuneRoles = config.data.message_reports.immune_roles;
		const isImmune = targetMember?.roles.cache.some(role => immuneRoles.includes(role.id));
		const blacklistedUsers = config.data.message_reports.blacklisted_users;

		if (blacklistedUsers.includes(reporter.id) || isImmune)
			return { ok: false, message: "You cannot report this message." };

		if (message.author.bot || message.system || message.webhookId)
			return { ok: false, message: "You cannot report bot, system, or webhook messages." };

		const originalReport = await kysely
			.selectFrom("MessageReport")
			.selectAll()
			.where("guild_id", "=", message.guild.id)
			.where("message_id", "=", message.id)
			.where("status", "=", ReportStatus.Pending)
			.executeTakeFirst();

		const webhook = new WebhookClient({ url: messageReports.webhook_url! });

		if (originalReport) {
			if (originalReport.reported_by === reporter.id) {
				webhook.destroy();
				return { ok: false, message: "You have already reported this message." };
			}

			// At any step of the process, if we fail we still return `ok: true` to avoid
			// letting the user know what has happened internally.
			const message = await webhook.fetchMessage(originalReport.id).catch(() => null);

			if (!message) {
				webhook.destroy();
				return { ok: true };
			}

			const embedIdx = message.embeds.length > 1 ? 1 : 0;
			const currentEmbed = message.embeds.at(embedIdx);

			if (!currentEmbed) {
				webhook.destroy();
				return { ok: true };
			}

			const currentValue =
				currentEmbed.fields?.find(field => {
					return field.name === "Reported By";
				})?.value ?? null;

			// Early return if the value can't be found or the reporter is already listed.
			if (!currentValue || currentValue.includes(reporter.id)) {
				webhook.destroy();
				return { ok: true };
			}

			const primaryEmbed = EmbedBuilder.from(currentEmbed)
				.spliceFields(0, 1, {
					name: "Reported By",
					value: `${currentValue}\n${userMentionWithId(reporter.id)}`
				})
				.setTimestamp();

			const secondaryEmbed = embedIdx === 1 ? message.embeds.at(0) : undefined;

			await webhook
				.editMessage(originalReport.id, {
					embeds: secondaryEmbed ? [secondaryEmbed, primaryEmbed] : [primaryEmbed]
				})
				.catch(() => null);

			await kysely
				.updateTable("MessageReport")
				.set({
					additional_reporters: [...originalReport.additional_reporters, reporter.id]
				})
				.where("id", "=", originalReport.id)
				.execute();

			metrics.count(SENTRY_METRICS_COUNTERS.MessageReportSubmitted, 1, {
				attributes: {
					guild_id: config.id,
					original_report_id: originalReport.id
				}
			});

			webhook.destroy();
			return { ok: true };
		}

		const messageContent = cleanContent(
			message.content ?? EMPTY_MESSAGE_CONTENT,
			message.channel
		);

		const croppedContent = cropLines(messageContent, 5);
		const stickerId = message.stickers.first()?.id ?? null;

		const formattedContent = await formatMessageContent({
			url: message.url,
			content: croppedContent,
			stickerId: stickerId,
			createdAt: message.createdAt
		});

		const embed = new EmbedBuilder()
			.setAuthor({ name: "New Message Report" })
			.setColor(Colors.Blue)
			.setThumbnail(message.author.displayAvatarURL())
			.setFields([
				{
					name: "Reported By",
					value: userMentionWithId(reporter.id)
				},
				{
					name: "Report Reason",
					value: reason ?? "No reason provided."
				},
				{
					name: "Message Author",
					value: userMentionWithId(message.author.id)
				},
				{
					name: "Message Content",
					value: formattedContent
				}
			])
			.setTimestamp();

		const reference = message.reference && (await message.fetchReference().catch(() => null));

		const embeds: EmbedBuilder[] = [];
		const actionRow = new ActionRowBuilder<ButtonBuilder>();

		if (reference) {
			const referenceContent = cleanContent(reference.content, reference.channel);
			const croppedReferenceContent = cropLines(referenceContent, 5);
			const stickerId = reference.stickers.first()?.id ?? null;

			const formattedReferenceContent = await formatMessageContent({
				url: reference.url,
				content: croppedReferenceContent,
				stickerId: stickerId,
				createdAt: reference.createdAt
			});

			const referenceEmbed = new EmbedBuilder()
				.setAuthor({ name: "Message Reference" })
				.setColor(Colors.NotQuiteBlack)
				.setFields([
					{
						name: "Reference Author",
						value: userMentionWithId(reference.author.id)
					},
					{
						name: "Reference Content",
						value: formattedReferenceContent
					}
				])
				.setTimestamp();

			embeds.push(referenceEmbed);
		}

		embeds.push(embed);

		const deleteMessageButton = new ButtonBuilder()
			.setCustomId(`delete-original-report-message-${message.channel.id}-${message.id}`)
			.setLabel("Delete Message")
			.setStyle(ButtonStyle.Danger);

		const resolveButton = new ButtonBuilder()
			.setCustomId(`message-report-resolve`)
			.setLabel("Resolve")
			.setStyle(ButtonStyle.Success);

		const disregardButton = new ButtonBuilder()
			.setCustomId("message-report-disregard")
			.setLabel("Disregard")
			.setStyle(ButtonStyle.Primary);

		const userInfoButton = new ButtonBuilder()
			.setCustomId(`user-info-${message.author.id}`)
			.setLabel("User Info")
			.setStyle(ButtonStyle.Secondary);

		if (reference) {
			const deleteReferenceButton = new ButtonBuilder()
				.setCustomId(
					`delete-reference-report-message-${reference.channel.id}-${reference.id}`
				)
				.setLabel("Delete Reference")
				.setStyle(ButtonStyle.Danger);

			actionRow.setComponents(
				resolveButton,
				disregardButton,
				deleteMessageButton,
				deleteReferenceButton,
				userInfoButton
			);
		} else {
			actionRow.setComponents(
				resolveButton,
				disregardButton,
				userInfoButton,
				deleteMessageButton
			);
		}

		const content =
			messageReports.notify_roles.length > 0
				? messageReports.notify_roles
						.map(role => (role === "here" ? "@here" : roleMention(role)))
						.join(", ")
				: undefined;

		const log = await webhook
			.send({
				content,
				embeds,
				components: [actionRow],
				allowedMentions: { parse: ["roles", "everyone"] }
			})
			.catch(() => null);

		if (!log) {
			return {
				ok: false,
				message: "Failed to submit message report."
			};
		}

		metrics.count(SENTRY_METRICS_COUNTERS.MessageReportSubmitted, 1, {
			attributes: { guild_id: config.id }
		});

		await kysely
			.insertInto("MessageReport")
			.values({
				id: log.id,
				guild_id: message.guild.id,
				message_id: message.id,
				reference_id: reference?.id ?? null,
				message_url: message.url,
				channel_id: message.channel.id,
				author_id: message.author.id,
				content: messageContent,
				reported_at: new Date(),
				reported_by: reporter.id,
				report_reason: reason ?? "No reason provided.",
				status: "Pending"
			})
			.execute()
			.then(() => webhook.destroy());

		return { ok: true };
	}

	/**
	 * Handles resolving or disregarding a message report.
	 *
	 * @param interaction The button interaction.
	 * @param action The action to perform (resolve or disregard).
	 * @param config The guild configuration.
	 *
	 * @returns The result of the operation.
	 */

	static async handle(
		interaction: ButtonInteraction<"cached">,
		action: MessageReportAction,
		config: GuildConfig
	): Promise<SimpleResult<{ logs: APIMessage[] | null }>> {
		if (!config.hasPermission(interaction.member, UserPermission.ReviewMessageReports))
			return { ok: false, message: "You don't have permission to review message reports" };

		const report = await kysely
			.selectFrom("MessageReport")
			.selectAll()
			.where("id", "=", interaction.message.id)
			.executeTakeFirst();

		if (!report) {
			interaction.message.delete().catch(() => null);

			return {
				ok: false,
				message: "Message report could not be found. It may have already been deleted."
			};
		}

		if (report.resolved_by) {
			interaction.message.delete().catch(() => null);

			return {
				ok: false,
				message: `This report was resolved by ${userMentionWithId(report.resolved_by)} on ${time(report.resolved_at!, "F")}.`
			};
		}

		const logs = await MessageReportUtils._log(interaction, action, config);
		MessageReportUtils._updateSubmissionMessage(interaction, action, config);

		metrics.count(SENTRY_METRICS_COUNTERS.MessageReportHandled, 1, {
			attributes: {
				guild_id: interaction.guild.id,
				action: action.toString()
			}
		});

		await kysely
			.updateTable("MessageReport")
			.set({
				resolved_by: interaction.user.id,
				resolved_at: new Date(),
				status: REPORT_ACTION_TO_STATUS[action]
			})
			.where("id", "=", interaction.message.id)
			.execute();

		return { ok: true, data: { logs } };
	}

	/**
	 * Searches for pending message reports in the guild, optionally filtered by a target user.
	 *
	 * @param data The search parameters.
	 *   - config: The guild configuration.
	 * 	 - controllerId: The ID of the interaction controller, used for pagination button custom IDs.
	 * 	 - target: An optional user to filter reports by their author.
	 * 	 - page: The page number for pagination (1-based).
	 * @returns The result of the search operation.
	 */

	static async search(data: {
		config: GuildConfig;
		executor: GuildMember;
		target: User | null;
		page: number;
	}): Promise<SimpleResult<ResponseData<"interaction">>> {
		const { config, executor, target, page } = data;

		const skipMultiplier = page - 1;

		let baseQuery = kysely
			.selectFrom("MessageReport")
			.where("guild_id", "=", config.id)
			.where("status", "=", ReportStatus.Pending);

		if (target) {
			baseQuery = baseQuery.where("author_id", "=", target.id);
		}

		const totalCount = await baseQuery
			.select(eb => eb.fn.countAll<number>().as("count"))
			.executeTakeFirstOrThrow();

		const reports = await baseQuery
			.selectAll()
			.orderBy("reported_at", "desc")
			.limit(5)
			.offset(skipMultiplier * 5)
			.execute();

		if (reports.length === 0)
			return {
				ok: true,
				data: { content: "No message reports found." }
			};

		const embed = new EmbedBuilder()
			.setColor(Colors.NotQuiteBlack)
			.setAuthor({
				name: `Pending Message Reports${target ? ` for @${target.username}` : ""}`,
				iconURL: target
					? target.displayAvatarURL()
					: (executor.guild.iconURL() ?? undefined)
			})
			.setTimestamp();

		if (target) {
			// Pagination relies on this format.
			embed.setFooter({ text: `User ID: ${target.id}` });
		}

		const fields = await MessageReportUtils._getSearchFields(reports, config, !!target);

		if (fields.length === 0) {
			embed.setDescription("No pending reports found.");
		} else {
			embed.setFields(fields);
		}

		const components: ActionRowBuilder<ButtonBuilder>[] = [];

		if (totalCount.count > 5) {
			const totalPages = Math.ceil(totalCount.count / 5);
			const paginationButtons = MessageReportUtils._getPaginationButtons(
				page,
				totalPages,
				executor.id
			);

			components.push(paginationButtons);
		}

		return {
			ok: true,
			data: {
				embeds: [embed],
				components
			}
		};
	}

	/**
	 * Retrieves the embed fields for a list of message reports, including reporter information and links to the original report messages if available.
	 *
	 * @param reports The list of message reports to generate fields for.
	 * @param config The guild configuration, used to determine if links to the original report messages can be generated.
	 * @param hasUserFilter Whether the search results are filtered by a specific user, which affects the formatting of the embed fields.
	 * @returns An array of embed fields representing the message reports.
	 */

	private static async _getSearchFields(
		reports: MessageReport[],
		config: GuildConfig,
		hasUserFilter: boolean
	) {
		const channelId = config.data.message_reports.webhook_channel;

		// Fetch all unique authors in parallel.
		const uniqueAuthorIds = [...new Set(reports.map(r => r.author_id))];
		const authorResults = await Promise.all(
			uniqueAuthorIds.map(id =>
				client.users.fetch(id).catch(() => ({ username: "unknown", id }))
			)
		);

		const authorMap = new Map(uniqueAuthorIds.map((id, i) => [id, authorResults[i]]));

		const fields: EmbedField[] = reports.map(report => {
			const target = authorMap.get(report.author_id)!;
			const truncatedReason = truncate(report.report_reason, 256);

			const reportURL = channelId
				? messageLink(channelId, report.id, report.guild_id)
				: null;

			const fieldName = hasUserFilter
				? `#${report.id}`
				: `#${report.id}, against @${target.username} (${target.id})`;

			return {
				name: fieldName,
				value: `Created On ${time(report.reported_at, "f")}${reportURL ? ` \`|\` [Jump to report](${reportURL})` : ""}\n\`${escapeCodeBlock(truncatedReason)}\``,
				inline: false
			};
		});

		return fields;
	}

	/**
	 * Generates pagination buttons for the message report search results.
	 *
	 * @param page The current page number (1-based).
	 * @param totalPages The total number of pages available.
	 * @param controllerId The ID of the interaction controller, used for constructing unique custom IDs for the buttons.
	 * @returns An ActionRowBuilder containing the pagination buttons.
	 */

	private static _getPaginationButtons(page: number, totalPages: number, controllerId: string) {
		const isFirstPage = page === 1;
		const isLastPage = page === totalPages;

		const pageCountButton = new ButtonBuilder()
			.setLabel(`${page} / ${totalPages}`)
			.setDisabled(true)
			.setStyle(ButtonStyle.Secondary)
			.setCustomId("report-search-page-count");

		const nextButton = new ButtonBuilder()
			.setLabel("→")
			.setCustomId(`report-search-next-${controllerId}`)
			.setDisabled(isLastPage)
			.setStyle(ButtonStyle.Primary);

		const previousButton = new ButtonBuilder()
			.setLabel("←")
			.setCustomId(`report-search-back-${controllerId}`)
			.setDisabled(isFirstPage)
			.setStyle(ButtonStyle.Primary);

		if (totalPages > 2) {
			const firstPageButton = new ButtonBuilder()
				.setLabel("«")
				.setCustomId(`report-search-first-${controllerId}`)
				.setDisabled(isFirstPage)
				.setStyle(ButtonStyle.Primary);

			const lastPageButton = new ButtonBuilder()
				.setLabel("»")
				.setCustomId(`report-search-last-${controllerId}`)
				.setDisabled(isLastPage)
				.setStyle(ButtonStyle.Primary);

			return new ActionRowBuilder<ButtonBuilder>().setComponents(
				firstPageButton,
				previousButton,
				pageCountButton,
				nextButton,
				lastPageButton
			);
		} else {
			return new ActionRowBuilder<ButtonBuilder>().setComponents(
				previousButton,
				pageCountButton,
				nextButton
			);
		}
	}

	/**
	 * Logs the action taken on a message report.
	 *
	 * @param interaction The interaction.
	 * @param action The action taken.
	 * @param config The guild configuration.
	 * @returns An array of APIMessage objects representing the logged messages, or null if logging is not enabled for this event.
	 */

	private static async _log(
		interaction: ButtonInteraction<"cached">,
		action: MessageReportAction,
		config: GuildConfig
	): Promise<APIMessage[] | null> {
		if (!config.canLogEvent(LoggingEvent.MessageReportReviewed)) return null;

		const formattedAction = REPORT_ACTION_TO_PAST_TENSE[action];

		const embedIdx = interaction.message.embeds.length > 1 ? 1 : 0;
		const currentEmbed = interaction.message.embeds.at(embedIdx);

		if (!currentEmbed) return null;

		const primaryEmbed = EmbedBuilder.from(currentEmbed)
			.setColor(REPORT_ACTION_TO_COLOR[action])
			.setAuthor({ name: `Message Report ${formattedAction}` })
			.setFooter({
				text: `${formattedAction} by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		const secondaryEmbed = embedIdx === 1 ? interaction.message.embeds.at(0) : undefined;

		return config.log(LoggingEvent.MessageReportReviewed, {
			embeds: secondaryEmbed ? [secondaryEmbed, primaryEmbed] : [primaryEmbed]
		});
	}

	/**
	 * Updates or deletes the original submission message based on the guild configuration.
	 *
	 * @param interaction The interaction.
	 * @param action The action taken on the report.
	 * @returns The result of the operation.
	 */

	private static async _updateSubmissionMessage(
		interaction: ButtonInteraction<"cached">,
		action: MessageReportAction,
		config: GuildConfig
	): Promise<void> {
		if (config.data.message_reports.delete_submission_on_handle) {
			interaction.message.delete().catch(() => null);
			return;
		}

		const formattedAction = REPORT_ACTION_TO_PAST_TENSE[action];

		const embedIdx = interaction.message.embeds.length > 1 ? 1 : 0;
		const currentEmbed = interaction.message.embeds.at(embedIdx);

		if (!currentEmbed) return;

		const primaryEmbed = EmbedBuilder.from(currentEmbed)
			.setColor(REPORT_ACTION_TO_COLOR[action])
			.setAuthor({ name: `Message Report ${formattedAction}` })
			.setFooter({
				text: `${formattedAction} by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		const secondaryEmbed = embedIdx === 1 ? interaction.message.embeds.at(0) : undefined;

		interaction
			.editReply({
				embeds: secondaryEmbed ? [secondaryEmbed, primaryEmbed] : [primaryEmbed],
				components: []
			})
			.catch(() => {});
	}
}

export enum MessageReportAction {
	Resolve = "resolve",
	Disregard = "disregard"
}

export const REPORT_ACTION_TO_PAST_TENSE: Record<MessageReportAction, string> = {
	[MessageReportAction.Resolve]: "Resolved",
	[MessageReportAction.Disregard]: "Disregarded"
};

export const REPORT_ACTION_TO_COLOR: Record<MessageReportAction, ColorResolvable> = {
	[MessageReportAction.Resolve]: Colors.Green,
	[MessageReportAction.Disregard]: Colors.Blurple
};

export const REPORT_ACTION_TO_STATUS: Record<MessageReportAction, ReportStatus> = {
	[MessageReportAction.Resolve]: ReportStatus.Resolved,
	[MessageReportAction.Disregard]: ReportStatus.Disregarded
};
