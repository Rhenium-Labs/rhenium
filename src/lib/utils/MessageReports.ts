import {
	type User,
	type Message,
	type ModalSubmitInteraction,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	roleMention,
	WebhookClient
} from "discord.js";

import { prisma } from "#root/index.js";
import { cropLines, userMentionWithId } from "./index.js";
import { cleanMessageContent, formatMessageContent } from "./Messages.js";

import type { MessageReportConfig } from "#prisma/client.js";
import type { InteractionReplyData } from "./Types.js";

export default class MessageReportUtils {
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
					value: await formatMessageContent(croppedContent, stickerId, message.url)
				}
			])
			.setTimestamp();

		const reference = message.reference && (await message.fetchReference().catch(() => null));

		const embeds: EmbedBuilder[] = [];
		const primaryRow = new ActionRowBuilder<ButtonBuilder>();
		const secondaryRow = new ActionRowBuilder<ButtonBuilder>();

		if (reference) {
			const referenceContent = cleanMessageContent(reference.content, reference.channel);
			const croppedReferenceContent = cropLines(referenceContent, 5);

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
						value: await formatMessageContent(
							croppedReferenceContent,
							reference.stickers.first()?.id ?? null,
							reference.url
						)
					}
				])
				.setTimestamp();

			embeds.push(referenceEmbed);
		}

		embeds.push(embed);

		const deleteMessageButton = new ButtonBuilder()
			.setCustomId(`delete-original-report-message-${message.channel.id}-${message.id}`)
			.setLabel("Delete Message")
			.setStyle(ButtonStyle.Secondary);

		const acceptButton = new ButtonBuilder()
			.setCustomId(`message-report-accept`)
			.setLabel("Accept")
			.setStyle(ButtonStyle.Success);

		const denyButton = new ButtonBuilder()
			.setCustomId("message-report-deny")
			.setLabel("Deny")
			.setStyle(ButtonStyle.Danger);

		const disregardButton = new ButtonBuilder()
			.setCustomId("message-report-disregard")
			.setLabel("Disregard")
			.setStyle(ButtonStyle.Secondary);

		const userInfoButton = new ButtonBuilder()
			.setCustomId(`user-info-${author.id}`)
			.setLabel("User Info")
			.setStyle(ButtonStyle.Secondary);

		const components: ActionRowBuilder<ButtonBuilder>[] = [];

		if (reference) {
			const deleteReferenceButton = new ButtonBuilder()
				.setCustomId(`delete-reference-report-message-${reference.channel.id}-${reference.id}`)
				.setLabel("Delete Reference")
				.setStyle(ButtonStyle.Secondary);

			primaryRow.setComponents(acceptButton, denyButton, disregardButton, userInfoButton);
			secondaryRow.setComponents(deleteMessageButton, deleteReferenceButton);

			components.push(primaryRow, secondaryRow);
		} else {
			primaryRow.setComponents(acceptButton, denyButton, disregardButton, deleteMessageButton, userInfoButton);
			components.push(primaryRow);
		}

		const webhook = new WebhookClient({ url: config.webhook_url! });
		const content =
			config.notify_roles.length > 0 ? config.notify_roles.map(r => roleMention(r)).join(", ") : undefined;

		const log = await webhook
			.send({
				content,
				embeds,
				components,
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

		return {
			content: `Successfully submitted a report for ${author}'s message - ID \`#${log.id}\``
		};
	}
}
