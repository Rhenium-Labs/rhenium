import {
	type User,
	type Message,
	type ModalSubmitInteraction,
	type ButtonInteraction,
	type MessageContextMenuCommandInteraction,
	type APIActionRowComponent,
	type APIButtonComponentWithCustomId,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	roleMention,
	WebhookClient,
	ComponentType,
	MessageFlags
} from "discord.js";

import { prisma } from "#root/index.js";
import { cropLines, userMentionWithId } from "./index.js";
import { cleanMessageContent, formatMessageContent } from "./Messages.js";

import type { MessageReport, MessageReportConfig } from "#prisma/client.js";
import type { InteractionReplyData } from "./Types.js";

export default class MessageReportUtils {
	/**
	 * Creates a message report and sends it to the configured webhook for review
	 *
	 * @param data The message report data.
	 * @returns Interaction reply data indicating success or failure.
	 */

	public static async create(data: {
		interaction: ModalSubmitInteraction<"cached">;
		config: MessageReportConfig;
		author: User;
		message: Message<true>;
		reason: string;
	}): Promise<InteractionReplyData> {
		const { interaction, config, author, message, reason } = data;

		const messageContent = cleanMessageContent(message.content, message.channel);
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
			const referenceContent = cleanMessageContent(reference.content, reference.channel);
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

		await prisma.messageReport.create({
			data: {
				id: log.id,
				guild_id: interaction.guildId,
				message_id: message.id,
				reference_id: reference?.id,
				message_url: message.url,
				channel_id: message.channel.id,
				author_id: message.author.id,
				content: content,
				reported_by: interaction.user.id,
				reported_at: new Date(),
				report_reason: reason
			}
		});

		webhook.destroy();

		return {
			content: `Successfully submitted a report for ${author}'s message - ID \`#${log.id}\``
		};
	}

	/**
	 * Bumps an existing message report submission to include the new reporter.
	 *
	 * @param data The bump submission data.
	 * @returns The sent API message or null if bumping failed.
	 */

	public static async bumpSubmission(data: {
		interaction: MessageContextMenuCommandInteraction<"cached">;
		config: MessageReportConfig;
		report: MessageReport;
	}): Promise<any> {
		const { interaction, report, config } = data;

		if (!config.enabled || !config.webhook_url) return null;

		const webhook = new WebhookClient({ url: config.webhook_url });
		const message = await webhook.fetchMessage(report.id).catch(() => null);

		if (!message) return null;

		const components = (message.components?.filter(c => c.type === ComponentType.ActionRow) ??
			[]) as APIActionRowComponent<APIButtonComponentWithCustomId>[];
		const hasReferenceEmbed = components
			.flatMap(row => row.components)
			.some(btn => btn.custom_id?.startsWith("delete-reference-report-message"));

		const embed = message.embeds.at(hasReferenceEmbed ? 1 : 0);
		const currentValue = embed?.fields?.find(field => {
			return field.name === "Reported By";
		})?.value;

		if (!embed || !currentValue) return null;
		// Prevent duplicate mentions.
		if (currentValue.includes(interaction.user.id)) return null;

		const updatedEmbed = EmbedBuilder.from(embed)
			.spliceFields(0, 1, {
				name: "Reported By",
				value: `${currentValue}\n${userMentionWithId(interaction.user.id)}`
			})
			.setTimestamp();

		return webhook
			.editMessage(message.id, {
				embeds: hasReferenceEmbed ? [message.embeds[0], updatedEmbed] : [updatedEmbed]
			})
			.catch(() => null)
			.then(() => webhook.destroy());
	}

	/**
	 * Handles resolving or disregarding a message report.
	 *
	 * @param data The message report action data.
	 * @return Interaction reply data indicating success or failure.
	 */

	public static async handle(data: {
		interaction: ButtonInteraction<"cached">;
		config: MessageReportConfig;
		action: MessageReportAction;
		report: MessageReport;
	}): Promise<InteractionReplyData | null> {
		const { interaction, action, report, config } = data;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		switch (action) {
			case MessageReportAction.Resolve: {
				await Promise.all([
					MessageReportUtils._log({
						config,
						action,
						interaction
					}),
					prisma.messageReport.update({
						where: { id: report.id },
						data: {
							resolved_by: interaction.user.id,
							resolved_at: new Date(),
							status: "Resolved"
						}
					}),
					interaction.message.delete().catch(() => null)
				]);

				return {
					content: `Successfully resolved message report - ID \`#${report.id}\`.`
				};
			}

			case MessageReportAction.Disregard: {
				await Promise.all([
					MessageReportUtils._log({
						config,
						action,
						interaction
					}),
					prisma.messageReport.update({
						where: { id: report.id },
						data: {
							resolved_by: interaction.user.id,
							resolved_at: new Date(),
							status: "Disregarded"
						}
					}),
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
		config: MessageReportConfig;
		action: MessageReportAction;
		interaction: ButtonInteraction<"cached">;
	}): Promise<any> {
		const { action, interaction, config } = data;

		if (!config.log_webhook_url) return null;

		const components = interaction.message.components!.filter(c => c.type === ComponentType.ActionRow);
		const hasDeleteRefButton = components.find(c =>
			c.components.some(comp => comp.customId?.startsWith("delete-reference-report-message"))
		);

		const formattedAction = action === MessageReportAction.Resolve ? "Resolved" : "Disregarded";

		const embed = new EmbedBuilder(interaction.message.embeds[hasDeleteRefButton ? 1 : 0].data)
			.setAuthor({ name: `Message Report ${formattedAction}` })
			.setColor(action === MessageReportAction.Resolve ? Colors.Green : Colors.NotQuiteBlack)
			.setFooter({
				text: `Reviewed by @${interaction.user.username} (${interaction.user.id})`,
				iconURL: interaction.user.displayAvatarURL()
			})
			.setTimestamp();

		const webhook = new WebhookClient({ url: config.log_webhook_url });

		return webhook
			.send({ embeds: hasDeleteRefButton ? [interaction.message.embeds[0], embed] : [embed] })
			.catch(() => null)
			.then(() => webhook.destroy());
	}
}

export const MessageReportAction = {
	Resolve: "resolve",
	Disregard: "disregard"
} as const;
export type MessageReportAction = (typeof MessageReportAction)[keyof typeof MessageReportAction];
