import {
	type ButtonInteraction,
	type ColorResolvable,
	type Message,
	type User,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	roleMention,
	time,
	WebhookClient
} from "discord.js";

import { kysely } from "#root/index.js";
import { EMPTY_MESSAGE_CONTENT } from "./Constants.js";
import { LoggingEvent, ReportStatus } from "#database/Enums.js";
import { cropLines, userMentionWithId } from "./index.js";
import { cleanContent, formatMessageContent } from "./Messages.js";

import type { SimpleResult } from "./Types.js";
import type { MessageReportUpdate } from "#database/Schema.js";

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
		const targetMember = await message.guild.members
			.fetch(message.author.id)
			.catch(() => null);

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
				? messageReports.notify_roles.map(roleMention).join(", ")
				: undefined;

		const log = await webhook
			.send({
				content,
				embeds,
				components: [actionRow],
				allowedMentions: { parse: ["roles"] }
			})
			.catch(() => null);

		if (!log) {
			return {
				ok: false,
				message: "Failed to submit message report."
			};
		}

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
	): Promise<SimpleResult> {
		if (!config.hasPermission(interaction.member, "ReviewMessageReports"))
			return { ok: false, message: "You don't have permission to review message reports" };

		const report = await kysely
			.selectFrom("MessageReport")
			.selectAll()
			.where("id", "=", interaction.message.id)
			.executeTakeFirst();

		if (!report) {
			void interaction.message.delete().catch(() => null);

			return {
				ok: false,
				message: "Message report could not be found. It may have already been deleted."
			};
		}

		if (report.resolved_by) {
			void interaction.message.delete().catch(() => null);

			return {
				ok: false,
				message: `This report was resolved by ${userMentionWithId(report.resolved_by)} on ${time(report.resolved_at!, "F")}.`
			};
		}

		void MessageReportUtils._log(interaction, action, config);
		void MessageReportUtils._updateSubmissionMessage(interaction, action, config);

		const data: MessageReportUpdate = {
			resolved_by: interaction.user.id,
			resolved_at: new Date(),
			status: MessageReportActionToStatusMap[action]
		};

		await kysely
			.updateTable("MessageReport")
			.set(data)
			.where("id", "=", interaction.message.id)
			.execute();

		return { ok: true };
	}

	/**
	 * Logs the action taken on a message report.
	 *
	 * @param interaction The interaction.
	 * @param action The action taken.
	 * @param config The guild configuration.
	 */

	private static async _log(
		interaction: ButtonInteraction<"cached">,
		action: MessageReportAction,
		config: GuildConfig
	): Promise<void> {
		if (!config.canLogEvent(LoggingEvent.MessageReportReviewed)) return;

		const formattedAction = MessageReportActionToPastTenseMap[action];

		const embedIdx = interaction.message.embeds.length > 1 ? 1 : 0;
		const currentEmbed = interaction.message.embeds.at(embedIdx);

		if (!currentEmbed) return;

		const primaryEmbed = EmbedBuilder.from(currentEmbed)
			.setColor(MessageReportActionToColorMap[action])
			.setAuthor({ name: `Message Report ${formattedAction}` })
			.setFooter({
				text: `${formattedAction} by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		const secondaryEmbed = embedIdx === 1 ? interaction.message.embeds.at(0) : undefined;

		return void config.log(LoggingEvent.MessageReportReviewed, {
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
			void interaction.message.delete().catch(() => null);
			return;
		}

		const formattedAction = MessageReportActionToPastTenseMap[action];

		const embedIdx = interaction.message.embeds.length > 1 ? 1 : 0;
		const currentEmbed = interaction.message.embeds.at(embedIdx);

		if (!currentEmbed) return;

		const primaryEmbed = EmbedBuilder.from(currentEmbed)
			.setColor(MessageReportActionToColorMap[action])
			.setAuthor({ name: `Message Report ${formattedAction}` })
			.setFooter({
				text: `${formattedAction} by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		const secondaryEmbed = embedIdx === 1 ? interaction.message.embeds.at(0) : undefined;

		void interaction
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

export const MessageReportActionToPastTenseMap: Record<MessageReportAction, string> = {
	[MessageReportAction.Resolve]: "Resolved",
	[MessageReportAction.Disregard]: "Disregarded"
};

const MessageReportActionToColorMap: Record<MessageReportAction, ColorResolvable> = {
	[MessageReportAction.Resolve]: Colors.Green,
	[MessageReportAction.Disregard]: Colors.Blurple
};

const MessageReportActionToStatusMap: Record<MessageReportAction, ReportStatus> = {
	[MessageReportAction.Resolve]: ReportStatus.Resolved,
	[MessageReportAction.Disregard]: ReportStatus.Disregarded
};
