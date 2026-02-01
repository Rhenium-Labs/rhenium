import { Colors, EmbedBuilder, MessageFlags, ComponentType } from "discord.js";

import { ContentFilterStatus } from "#kysely/Enums.js";
import { ApplyOptions, Component } from "#rhenium";
import { ContentFilterFieldNames } from "#cf/Enums.js";
import { hastebin, userMentionWithId } from "#utils/index.js";

import type { InteractionReplyData } from "#utils/Types.js";

import Messages from "#utils/Messages.js";
import GuildConfig from "#root/lib/config/GuildConfig.js";
import ContentFilterUtils from "#utils/ContentFilter.js";
import AutomatedScanner from "#cf/AutomatedScanner.js";

@ApplyOptions<Component.Options>({
	id: { matches: /^cf-(delete|resolve|false|content)-[\d-]+$/m }
})
export default class ContentFilterButton extends Component {
	public async run(
		interaction: Component.Interaction<"button">,
		configClass: GuildConfig
	): Promise<InteractionReplyData | null> {
		const config = configClass.getContentFilterConfig();

		if (!config) {
			return { error: "Content filter is not configured for this server." };
		}

		const parts = interaction.customId.split("-");
		const action = parts[1] as "delete" | "resolve" | "false" | "content";

		switch (action) {
			case "delete": {
				return this._handleDelete(interaction, parts);
			}
			case "resolve": {
				return this._handleResolve(interaction, parts);
			}
			case "false": {
				return this._handleFalsePositive(interaction, parts);
			}
			case "content": {
				return this._handleViewContent(interaction, parts);
			}
		}
	}

	/**
	 * Handle the delete message action.
	 *
	 * @param interaction The button interaction.
	 * @param parts The custom ID parts.
	 */
	private async _handleDelete(
		interaction: Component.Interaction<"button">,
		parts: string[]
	): Promise<InteractionReplyData | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const messageId = parts[2];
		const channelId = parts[3];

		// Fetch the alert from the database
		const alert = await ContentFilterUtils.getAlertByMessageId(messageId);

		const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);

		if (!channel || !channel.isTextBased()) {
			return { error: "Could not find the channel containing the flagged message." };
		}

		const message = await channel.messages.fetch(messageId).catch(() => null);

		if (!message) {
			// Message already deleted - update alert status
			if (alert) {
				await ContentFilterUtils.updateAlertDelStatus(
					alert.id,
					ContentFilterStatus.Deleted
				);
			}

			return { error: "The flagged message no longer exists or was already deleted." };
		}

		const deleted = await message.delete().catch(() => null);

		if (!deleted) {
			return { error: "Failed to delete the message. I may lack permissions." };
		}

		// Update alert status in database.
		if (alert) {
			await ContentFilterUtils.updateAlertDelStatus(alert.id, ContentFilterStatus.Deleted);
			await ContentFilterUtils.updateAlertModStatus(
				alert.id,
				ContentFilterStatus.Resolved
			);
		}

		// Update the original embed to show it was handled.
		const embed = EmbedBuilder.from(interaction.message.embeds[0] ?? {}).setColor(
			Colors.Green
		);

		// Update status fields
		const fields = embed.data.fields ?? [];
		const updatedFields = fields.map(field => {
			if (field.name === ContentFilterFieldNames.DelStatus) {
				return { ...field, value: getStatusDisplay(ContentFilterStatus.Deleted) };
			}
			if (field.name === ContentFilterFieldNames.ModStatus) {
				return { ...field, value: getStatusDisplay(ContentFilterStatus.Resolved) };
			}
			return field;
		});

		embed.setFields(updatedFields);
		embed.addFields({
			name: "Resolved By",
			value: userMentionWithId(interaction.user.id),
			inline: true
		});

		await interaction.message
			.edit({
				embeds: [embed],
				components: []
			})
			.catch(() => null);

		return {
			content: `Successfully deleted the flagged message from ${message.author}.`
		};
	}

	/**
	 * Handle the resolve action (dismiss without deleting).
	 *
	 * @param interaction The button interaction.
	 * @param parts The custom ID parts.
	 */
	private async _handleResolve(
		interaction: Component.Interaction<"button">,
		parts: string[]
	): Promise<InteractionReplyData | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const messageId = parts[2];

		// Fetch the alert from the database
		const alert = await ContentFilterUtils.getAlertByMessageId(messageId);

		if (alert) {
			// Handle status transition
			const newStatus = ContentFilterUtils.handleAlertModStatus(
				alert.mod_status,
				ContentFilterStatus.Resolved
			);
			await ContentFilterUtils.updateAlertModStatus(alert.id, newStatus);
		}

		const embed = EmbedBuilder.from(interaction.message.embeds[0] ?? {}).setColor(
			Colors.Green
		);

		// Update status fields
		const fields = embed.data.fields ?? [];
		const updatedFields = fields.map(field => {
			if (field.name === ContentFilterFieldNames.ModStatus) {
				return { ...field, value: getStatusDisplay(ContentFilterStatus.Resolved) };
			}
			return field;
		});

		embed.setFields(updatedFields);
		embed.addFields({
			name: "Resolved By",
			value: userMentionWithId(interaction.user.id),
			inline: true
		});

		await interaction.message
			.edit({
				embeds: [embed],
				components: []
			})
			.catch(() => null);

		return {
			content: "Alert marked as resolved."
		};
	}

	/**
	 * Handle the false positive action.
	 *
	 * @param interaction The button interaction.
	 * @param parts The custom ID parts.
	 */
	private async _handleFalsePositive(
		interaction: Component.Interaction<"button">,
		parts: string[]
	): Promise<InteractionReplyData | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const channelId = parts[2];

		// Parse messageId from the resolve button if available
		let messageId: string | undefined;
		for (const row of interaction.message.components) {
			if ("components" in row) {
				for (const component of row.components) {
					if (
						component.type === ComponentType.Button &&
						component.customId?.startsWith("cf-resolve-")
					) {
						messageId = component.customId.split("-")[2];
						break;
					}
				}
			}
			if (messageId) break;
		}

		// Fetch the alert from the database
		const alert = messageId ? await ContentFilterUtils.getAlertByMessageId(messageId) : null;

		if (alert) {
			// Handle status transition
			const newStatus = ContentFilterUtils.handleAlertModStatus(
				alert.mod_status,
				ContentFilterStatus.False
			);
			await ContentFilterUtils.updateAlertModStatus(alert.id, newStatus);
		}

		// Update the automated scanner's feedback
		await AutomatedScanner.handleModeratorFeedback(channelId, true);

		const embed = EmbedBuilder.from(interaction.message.embeds[0] ?? {}).setColor(
			Colors.Grey
		);

		// Update status fields
		const fields = embed.data.fields ?? [];
		const updatedFields = fields.map(field => {
			if (field.name === ContentFilterFieldNames.ModStatus) {
				return { ...field, value: getStatusDisplay(ContentFilterStatus.False) };
			}
			return field;
		});

		embed.setFields(updatedFields);
		embed.addFields({
			name: "Marked False By",
			value: userMentionWithId(interaction.user.id),
			inline: true
		});

		await interaction.message
			.edit({
				embeds: [embed],
				components: []
			})
			.catch(() => null);

		return {
			content: "Alert marked as false positive. This feedback will help improve future scanning accuracy."
		};
	}

	/**
	 * Handle viewing the message content.
	 *
	 * @param interaction The button interaction.
	 * @param parts The custom ID parts.
	 */
	private async _handleViewContent(
		interaction: Component.Interaction<"button">,
		parts: string[]
	): Promise<InteractionReplyData | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const messageId = parts[2];

		// First try to get content from ContentFilterLog (flagged content)
		const alert = await ContentFilterUtils.getAlertByMessageId(messageId);
		if (alert) {
			const logContent = await ContentFilterUtils.getContentLogByAlertId(alert.id);
			if (logContent) {
				// If content is short, display inline; otherwise upload to hastebin
				if (logContent.length <= 1024) {
					return {
						embeds: [
							new EmbedBuilder()
								.setColor(Colors.Blurple)
								.setTitle("Flagged Content")
								.setDescription(`\`\`\`\n${logContent}\n\`\`\``)
								.setFooter({ text: `Message ID: ${messageId}` })
						]
					};
				}

				const url = await hastebin(logContent, "txt");
				if (url) {
					return {
						embeds: [
							new EmbedBuilder()
								.setColor(Colors.Blurple)
								.setTitle("Flagged Content")
								.setDescription(
									`Content is too long to display here.\n\n[View full content](${url})`
								)
								.setFooter({ text: `Message ID: ${messageId}` })
						]
					};
				}
			}
		}

		// Fall back to the message content in the Message table
		const dbMessage = await Messages.get(messageId);

		if (!dbMessage) {
			return { error: "Could not find the message content in the database." };
		}

		const content = dbMessage.content ?? "[No text content]";

		// If content is short, display inline; otherwise upload to hastebin
		if (content.length <= 1024) {
			return {
				embeds: [
					new EmbedBuilder()
						.setColor(Colors.Blurple)
						.setTitle("Message Content")
						.setDescription(`\`\`\`\n${content}\n\`\`\``)
						.setFooter({ text: `Message ID: ${messageId}` })
				]
			};
		}

		const url = await hastebin(content, "txt");
		if (!url) {
			return { error: "Failed to upload content to hastebin." };
		}

		return {
			embeds: [
				new EmbedBuilder()
					.setColor(Colors.Blurple)
					.setTitle("Message Content")
					.setDescription(
						`Content is too long to display here.\n\n[View full content](${url})`
					)
					.setFooter({ text: `Message ID: ${messageId}` })
			]
		};
	}
}

/** Status helper. */
const getStatusDisplay = (status: ContentFilterStatus): string => {
	switch (status) {
		case ContentFilterStatus.Pending:
			return "Pending...";
		case ContentFilterStatus.Resolved:
			return "Resolved";
		case ContentFilterStatus.False:
			return "False Positive";
		case ContentFilterStatus.Deleted:
			return "Deleted";
		default:
			return "Pending...";
	}
};
