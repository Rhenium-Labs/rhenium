import {
	type User,
	type ModalSubmitInteraction,
	type ButtonInteraction,
	ApplicationCommandType,
	LabelBuilder,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	EmbedBuilder,
	Colors,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	WebhookClient,
	roleMention
} from "discord.js";

import { kysely } from "#root/index.js";
import { ApplyOptions, Command } from "#rhenium";
import { cropLines, userMentionWithId } from "#utils/index.js";

import type { MessageReport } from "#kysely/Schema.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Messages from "#utils/Messages.js";
import GuildConfig, { ValidatedMessageReportsConfig } from "#config/GuildConfig.js";

@ApplyOptions<Command.Options>({
	name: "Report Message",
	description: "Report a message to the server moderators."
})
export default class ReportMessageCtx extends Command {
	public register(): Command.Data {
		return {
			name: this.name,
			type: ApplicationCommandType.Message
		};
	}

	public async interactionRun(
		interaction: Command.Interaction<"messageContextMenu">,
		configClass: GuildConfig
	): Promise<InteractionReplyData | null> {
		const config = configClass.getMessageReportsConfig();

		if (!config?.enforce_report_reason) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}

		if (!config) {
			return {
				error: "Message reports have not been configured on this server."
			};
		}

		if (config.blacklisted_users.includes(interaction.user.id)) {
			return {
				error: "You are blacklisted from reporting messages on this server."
			};
		}

		const message = interaction.targetMessage;
		const targetUser = interaction.targetMessage.author;
		const targetMember = interaction.targetMessage.member;

		if (message.author.bot || message.webhookId || message.system) {
			return {
				error: "You cannot report bot, webhook, or system messages."
			};
		}

		if (!targetUser) {
			return {
				error: "The target message's author could not be found."
			};
		}

		if (targetUser.id === interaction.user.id) {
			return {
				error: "You cannot report your own messages."
			};
		}

		if (targetUser.id === interaction.guild.ownerId) {
			return {
				error: "You cannot report messages sent by the server owner."
			};
		}

		if (!targetMember && config.enforce_member_in_guild) {
			return {
				error: "You can only report messages whose authors are still in the server."
			};
		}

		if (targetMember) {
			if (targetMember.roles.cache.some(role => config.immune_roles.includes(role.id))) {
				return {
					error: "You cannot report this message."
				};
			}
		}

		const report = await kysely
			.selectFrom("MessageReport")
			.selectAll()
			.where("guild_id", "=", interaction.guild.id)
			.where("message_id", "=", message.id)
			.where("status", "=", "Pending")
			.executeTakeFirst();

		if (report) {
			if (report.reported_by === interaction.user.id) {
				return {
					error: "You have already reported this message."
				};
			}

			void ReportMessageCtx.updateReport({
				interaction,
				config,
				report
			});

			return {
				content: `Successfully bumped report submission for ${targetUser}'s message - ID \`#${report.id}\``
			};
		}

		if (!config.enforce_report_reason) {
			return ReportMessageCtx.createReport({
				author: message.author,
				interaction,
				config,
				message,
				reason: config.placeholder_reason ?? "No reason provided."
			});
		}

		const reasonInput = new TextInputBuilder()
			.setCustomId("report-reason")
			.setStyle(TextInputStyle.Paragraph)
			.setMaxLength(1024)
			.setMinLength(1)
			.setRequired(true);

		if (config.placeholder_reason) {
			reasonInput.setValue(config.placeholder_reason);
		}

		// prettier-ignore
		const reasonLabel = new LabelBuilder()
			.setLabel("Reason")
			.setTextInputComponent(reasonInput);

		const modal = new ModalBuilder()
			.setCustomId(`report-message-${message.channel.id}-${message.id}`)
			.setTitle(`Report @${targetUser.username}'s Message`)
			.addLabelComponents(reasonLabel);

		return interaction.showModal(modal).then(() => null);
	}

	/**
	 * Creates a message report and sends it to the configured webhook for review.
	 *
	 * @param data The message report data.
	 * @returns Interaction reply data indicating success or failure.
	 */

	static async createReport(data: {
		interaction: Command.Interaction<"messageContextMenu"> | ModalSubmitInteraction<"cached">;
		config: ValidatedMessageReportsConfig;
		author: User;
		message: Command.Message;
		reason: string;
	}): Promise<InteractionReplyData> {
		const { interaction, config, author, message, reason } = data;

		const messageContent = Messages.cleanContent(message.content, message.channel);
		const croppedContent = cropLines(messageContent, 5);
		const stickerId = message.stickers.first()?.id ?? null;

		const formattedContent = await Messages.formatContent({
			url: message.url,
			content: croppedContent,
			stickerId: stickerId,
			createdAt: message.createdAt
		});

		const embed = new EmbedBuilder()
			.setAuthor({ name: "New Message Report" })
			.setColor(Colors.Blue)
			.setThumbnail(author.displayAvatarURL())
			.setFields([
				{
					name: "Reported By",
					value: userMentionWithId(interaction.user.id)
				},
				{
					name: "Report Reason",
					value: reason
				},
				{
					name: "Message Author",
					value: userMentionWithId(author.id)
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
			const referenceContent = Messages.cleanContent(reference.content, reference.channel);
			const croppedReferenceContent = cropLines(referenceContent, 5);
			const stickerId = reference.stickers.first()?.id ?? null;

			const formattedReferenceContent = await Messages.formatContent({
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
			.setCustomId(`user-info-${author.id}`)
			.setLabel("User Info")
			.setStyle(ButtonStyle.Secondary);

		if (reference) {
			const deleteReferenceButton = new ButtonBuilder()
				.setCustomId(`delete-reference-report-message-${reference.channel.id}-${reference.id}`)
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
			actionRow.setComponents(resolveButton, disregardButton, userInfoButton, deleteMessageButton);
		}

		const webhook = new WebhookClient({ url: config.webhook_url! });
		const content =
			config.notify_roles.length > 0 ? config.notify_roles.map(r => roleMention(r)).join(", ") : undefined;

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
				error: "Failed to submit message report."
			};
		}

		void kysely
			.insertInto("MessageReport")
			.values({
				id: log.id,
				guild_id: interaction.guildId!,
				message_id: message.id,
				reference_id: reference?.id ?? null,
				message_url: message.url,
				channel_id: message.channel.id,
				author_id: message.author.id,
				content: content ?? null,
				reported_at: new Date(),
				reported_by: interaction.user.id,
				report_reason: reason,
				status: "Pending"
			})
			.execute()
			.then(() => webhook.destroy());

		return {
			content: `Successfully submitted a report for ${author}'s message - ID \`#${log.id}\``
		};
	}

	/**
	 * Updates an existing message report submission to include the new reporter.
	 *
	 * @param data The update submission data.
	 * @returns The sent API message or null if updating failed.
	 */

	static async updateReport(data: {
		interaction: Command.Interaction<"messageContextMenu">;
		config: ValidatedMessageReportsConfig;
		report: MessageReport;
	}): Promise<any> {
		const { interaction, report, config } = data;

		if (!config.enabled || !config.webhook_url) return null;

		const webhook = new WebhookClient({ url: config.webhook_url });
		const message = await webhook.fetchMessage(report.id).catch(() => null);

		if (!message) return null;

		const embedIndex = message.embeds.length > 1 ? 1 : 0;
		const embed = message.embeds.at(embedIndex);
		const value = embed?.fields?.find(field => {
			return field.name === "Reported By";
		})?.value;

		if (!embed || !value) return null;
		// Prevent duplicate mentions.
		if (value.includes(interaction.user.id)) return null;

		const updatedEmbed = EmbedBuilder.from(embed)
			.spliceFields(0, 1, {
				name: "Reported By",
				value: `${value}\n${userMentionWithId(interaction.user.id)}`
			})
			.setTimestamp();

		const embeds =
			message.embeds.length > 1 ? [new EmbedBuilder(message.embeds.at(0)), updatedEmbed] : [updatedEmbed];

		return webhook
			.editMessage(message.id, { embeds })
			.catch(() => null)
			.then(() => webhook.destroy());
	}

	/**
	 * Processes resolving or disregarding a message report.
	 *
	 * @param data The message report action data.
	 * @return Interaction reply data indicating success or failure.
	 */

	static async processReport(data: {
		interaction: ButtonInteraction<"cached">;
		config: ValidatedMessageReportsConfig;
		action: MessageReportAction;
		report: MessageReport;
	}): Promise<InteractionReplyData | null> {
		const { interaction, action, report, config } = data;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		switch (action) {
			case MessageReportAction.Resolve: {
				void Promise.all([
					ReportMessageCtx._log({
						config,
						action,
						interaction
					}),
					kysely
						.updateTable("MessageReport")
						.set({
							resolved_by: interaction.user.id,
							resolved_at: new Date(),
							status: "Resolved"
						})
						.where("id", "=", report.id)
						.execute(),
					interaction.message.delete().catch(() => null)
				]);

				return {
					content: `Successfully resolved message report - ID \`#${report.id}\`.`
				};
			}

			case MessageReportAction.Disregard: {
				void Promise.all([
					ReportMessageCtx._log({
						config,
						action,
						interaction
					}),
					kysely
						.updateTable("MessageReport")
						.set({
							resolved_by: interaction.user.id,
							resolved_at: new Date(),
							status: "Disregarded"
						})
						.where("id", "=", report.id)
						.execute(),
					interaction.message.delete().catch(() => null)
				]);

				return {
					content: `Successfully disregarded message report - ID \`#${report.id}\`.`
				};
			}
		}
	}

	/**
	 * Logs the action taken on a message report to the configured log webhook.
	 *
	 * @param data The log data.
	 * @returns The sent API message or null if logging failed.
	 */

	private static async _log(data: {
		config: ValidatedMessageReportsConfig;
		action: MessageReportAction;
		interaction: ButtonInteraction<"cached">;
	}): Promise<any> {
		const { action, interaction, config } = data;

		if (!config.log_webhook_url) return null;

		const formattedAction = action === MessageReportAction.Resolve ? "Resolved" : "Disregarded";

		const embedIndex = interaction.message.embeds.length > 1 ? 1 : 0;
		const embed = interaction.message.embeds.at(embedIndex);

		if (!embed) return null;

		const updatedEmbed = new EmbedBuilder(embed.data)
			.setAuthor({ name: `Message Report ${formattedAction}` })
			.setColor(action === MessageReportAction.Resolve ? Colors.Green : Colors.NotQuiteBlack)
			.setFooter({
				text: `Reviewed by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		const webhook = new WebhookClient({ url: config.log_webhook_url });
		const embeds =
			interaction.message.embeds.length > 1
				? [new EmbedBuilder(interaction.message.embeds.at(0)?.data), updatedEmbed]
				: [updatedEmbed];

		return webhook
			.send({ embeds })
			.catch(() => null)
			.then(() => webhook.destroy());
	}
}

export const MessageReportAction = {
	Resolve: "resolve",
	Disregard: "disregard"
} as const;
export type MessageReportAction = (typeof MessageReportAction)[keyof typeof MessageReportAction];
