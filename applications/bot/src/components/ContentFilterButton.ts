import {
	Colors,
	ComponentType,
	EmbedBuilder,
	MessageFlags,
	type ButtonInteraction
} from "discord.js";

import { ContentFilterStatus } from "@repo/db";
import { ContentFilterFieldNames, parseContentFilterCustomId } from "#managers/cf/Enums.js";
import { hastebin, userMentionWithId } from "#utils/index.js";

import type { ParsedContentFilterCustomId } from "#managers/cf/Enums.js";
import type { ResponseData } from "#commands/Command.js";
import type { ComponentExecutionContext } from "#components/Component.js";

import Component from "#components/Component.js";
import ContentFilterUtils from "#utils/ContentFilter.js";
import AutomatedScanner from "#managers/cf/AutomatedScanner.js";
import MessageManager from "#database/Messages.js";

/**
 * Handles moderation actions for content-filter alert buttons.
 */
export default class ContentFilterButton extends Component {
	/**
	 * Registers the component matcher for versioned content-filter button payloads.
	 */
	constructor() {
		super({ matches: /^cfb1:(del|res|fp|content):/m });
	}

	/**
	 * Routes a button interaction to the corresponding content-filter action handler.
	 *
	 * @param context The button execution context.
	 * @returns A response payload for the interaction lifecycle.
	 */
	async execute({
		interaction,
		config
	}: ComponentExecutionContext<"button">): Promise<ResponseData<"interaction"> | null> {
		const contentFilterConfig = config.parseContentFilterConfig();

		if (!contentFilterConfig) {
			return { error: "Content filter is not configured for this server." };
		}

		const parsed = parseContentFilterCustomId(interaction.customId);
		if (!parsed) {
			return { error: "Unsupported content filter action payload." };
		}

		switch (parsed.action) {
			case "delete": {
				return this._handleDelete(interaction, parsed);
			}
			case "resolve": {
				return this._handleResolve(interaction, parsed);
			}
			case "false": {
				return this._handleFalsePositive(interaction, parsed);
			}
			case "content": {
				return this._handleViewContent(interaction, parsed);
			}
		}
	}

	/**
	 * Handle the delete message action.
	 *
	 * @param interaction The button interaction.
	 * @param parsed The parsed custom ID payload.
	 */
	private async _handleDelete(
		interaction: ButtonInteraction<"cached">,
		parsed: Extract<ParsedContentFilterCustomId, { action: "delete" }>
	): Promise<ResponseData<"interaction"> | null> {
		await interaction.deferUpdate();

		const { messageId, channelId } = parsed;

		// Fetch alert and channel in parallel.
		const [alert, channel] = await Promise.all([
			ContentFilterUtils.getAlertByMessageId(messageId),
			interaction.guild.channels.fetch(channelId).catch(() => null)
		]);

		if (!channel || !channel.isTextBased()) {
			await interaction
				.followUp({
					content: "Could not find the channel containing the flagged message.",
					flags: MessageFlags.Ephemeral
				})
				.catch(() => null);
			return null;
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

			await this._updateSubmissionMessage(interaction, {
				color: Colors.Blue,
				flag: `Message Deleted (by ${interaction.user})`,
				componentsMode: "disable-delete"
			});

			await interaction
				.followUp({
					content: "The flagged message was already deleted. Delete action is now disabled; you can still resolve or mark false-positive.",
					flags: MessageFlags.Ephemeral
				})
				.catch(() => null);

			return null;
		}

		const deleted = await message.delete().catch(() => null);

		if (!deleted) {
			await interaction
				.followUp({
					content: "Failed to delete the message. I may lack permissions.",
					flags: MessageFlags.Ephemeral
				})
				.catch(() => null);
			return null;
		}

		// Update deletion status only; moderator disposition remains open.
		if (alert) {
			await ContentFilterUtils.updateAlertDelStatus(alert.id, ContentFilterStatus.Deleted);
		}

		await this._updateSubmissionMessage(interaction, {
			color: Colors.Blue,
			flag: `Message Deleted (by ${interaction.user})`,
			componentsMode: "disable-delete"
		});

		await interaction
			.followUp({
				content: `Successfully deleted the flagged message from ${message.author}. You can still resolve or mark false-positive.`,
				flags: MessageFlags.Ephemeral
			})
			.catch(() => null);

		return null;
	}

	/**
	 * Handle the resolve action (dismiss without deleting).
	 *
	 * @param interaction The button interaction.
	 * @param parsed The parsed custom ID payload.
	 */
	private async _handleResolve(
		interaction: ButtonInteraction<"cached">,
		parsed: Extract<ParsedContentFilterCustomId, { action: "resolve" }>
	): Promise<ResponseData<"interaction"> | null> {
		await interaction.deferUpdate();

		const { messageId } = parsed;

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

		await this._updateSubmissionMessage(interaction, {
			color: Colors.Green,
			footerText: `Resolved by ${userMentionWithId(interaction.user.id)}`,
			componentsMode: "clear"
		});

		await interaction
			.followUp({
				content: "Alert marked as resolved.",
				flags: MessageFlags.Ephemeral
			})
			.catch(() => null);

		return null;
	}

	/**
	 * Handle the false positive action.
	 *
	 * @param interaction The button interaction.
	 * @param parsed The parsed custom ID payload.
	 */
	private async _handleFalsePositive(
		interaction: ButtonInteraction<"cached">,
		parsed: Extract<ParsedContentFilterCustomId, { action: "false" }>
	): Promise<ResponseData<"interaction"> | null> {
		await interaction.deferUpdate();

		const { channelId, messageId } = parsed;

		// Fetch the alert from the database
		const alert = await ContentFilterUtils.getAlertByMessageId(messageId);

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

		await this._updateSubmissionMessage(interaction, {
			color: Colors.NotQuiteBlack,
			footerText: `Marked false-positive by ${userMentionWithId(interaction.user.id)}`,
			componentsMode: "clear"
		});

		await interaction
			.followUp({
				content: "Alert marked as false positive. This feedback will help improve future scanning accuracy.",
				flags: MessageFlags.Ephemeral
			})
			.catch(() => null);

		return null;
	}

	/**
	 * Handle viewing the message content.
	 *
	 * @param interaction The button interaction.
	 * @param parsed The parsed custom ID payload.
	 */
	private async _handleViewContent(
		interaction: ButtonInteraction<"cached">,
		parsed: Extract<ParsedContentFilterCustomId, { action: "content" }>
	): Promise<ResponseData<"interaction"> | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const { messageId } = parsed;
		const detailsEmbed = new EmbedBuilder()
			.setColor(Colors.Blue)
			.setTitle("Content Filter Details")
			.setFooter({ text: `Message ID: ${messageId}` })
			.setTimestamp();

		// First try to get content from ContentFilterLog (flagged content)
		const alert = await ContentFilterUtils.getAlertByMessageId(messageId);
		if (alert) {
			detailsEmbed.addFields(
				{ name: "Alert ID", value: alert.id, inline: true },
				{ name: "Offender", value: userMentionWithId(alert.offender_id), inline: true },
				{
					name: "Detected By",
					value:
						alert.detectors.length > 0 ? alert.detectors.join(", ") : "Heuristic",
					inline: true
				}
			);
		}

		if (alert) {
			const logContent = await ContentFilterUtils.getContentLogByAlertId(alert.id);
			if (logContent) {
				const segments = logContent
					.split("\n---\n")
					.map(s => s.trim())
					.filter(Boolean);

				const preview = segments[0] ?? logContent;
				const summary =
					segments.length > 0
						? segments
								.slice(0, 4)
								.map(
									(segment, idx) =>
										`${idx + 1}. ${truncateInline(segment, 120)}`
								)
								.join("\n")
						: "No detector segments recorded.";

				detailsEmbed.addFields(
					{
						name: "Flagged Segments",
						value:
							summary.length > 1024 ? summary.slice(0, 1021) + "..." : summary
					},
					{
						name: "Preview",
						value: toCodeBlock(truncateBlock(preview, 900))
					}
				);

				if (logContent.length > 900) {
					const url = await hastebin(logContent, "txt");
					if (url) {
						detailsEmbed.addFields({
							name: "Full Content",
							value: `[Open full detector content](${url})`
						});
					}
				}

				return { embeds: [detailsEmbed] };
			}
		}

		// Fall back to the message content in the Message table
		const dbMessage = await MessageManager.get(messageId);

		if (!dbMessage) {
			return { error: "Could not find the message content in the database." };
		}

		const content = dbMessage.content ?? "[No text content]";
		detailsEmbed.addFields({
			name: "Stored Message Content",
			value: toCodeBlock(truncateBlock(content, 900))
		});

		if (content.length > 900) {
			const url = await hastebin(content, "txt");
			if (url) {
				detailsEmbed.addFields({
					name: "Full Content",
					value: `[Open full message content](${url})`
				});
			}
		}

		return { embeds: [detailsEmbed] };
	}

	/**
	 * Updates the original alert message embed and component state.
	 *
	 * @param interaction The active button interaction.
	 * @param options Display and component update options for the alert message.
	 */
	private async _updateSubmissionMessage(
		interaction: ButtonInteraction<"cached">,
		options: {
			color: number;
			flag?: string;
			footerText?: string;
			componentsMode?: "clear" | "disable-delete";
		}
	): Promise<void> {
		const current = interaction.message.embeds.at(0);
		if (!current) return;

		const embed = EmbedBuilder.from(current).setColor(options.color).setTimestamp();
		const fields = embed.data.fields ?? [];

		const removableFields = new Set([
			"Deletion Status",
			"Moderation Status",
			ContentFilterFieldNames.Flags,
			"Resolved By",
			"Marked False By"
		]);

		const updatedFields = fields.filter(field => !removableFields.has(field.name));

		if (options.flag) {
			updatedFields.push({
				name: ContentFilterFieldNames.Flags,
				value: options.flag,
				inline: false
			});
		}

		embed.setFields(updatedFields);

		if (options.footerText) {
			embed.setFooter({ text: options.footerText });
		}

		const components =
			options.componentsMode === "disable-delete"
				? disableDeleteButton(interaction.message.components)
				: [];

		await interaction
			.editReply({
				embeds: [embed],
				components: components as any
			})
			.catch(() => null);
	}
}

type InteractionComponents = ButtonInteraction<"cached">["message"]["components"];

/**
 * Mutable shape used to safely patch serialized component rows.
 */
type MutableSerializedRow = {
	components?: Array<{
		type: number;
		custom_id?: string;
		disabled?: boolean;
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
};

/**
 * Disables only the delete action button while preserving the remaining action buttons.
 *
 * @param rows Component rows from the original alert message.
 * @returns Serialized component rows with delete button state updated.
 */
const disableDeleteButton = (rows: InteractionComponents): any[] => {
	return rows.map(row => {
		const data = row.toJSON() as unknown as MutableSerializedRow;

		if (!Array.isArray(data.components)) {
			return data;
		}

		return {
			...data,
			components: data.components.map(component => {
				if (
					component.type === ComponentType.Button &&
					typeof component.custom_id === "string"
				) {
					const parsed = parseContentFilterCustomId(component.custom_id);
					if (parsed?.action === "delete") {
						return {
							...component,
							disabled: true
						};
					}
				}

				return component;
			})
		};
	});
};

/**
 * Truncates a text snippet to a single-line preview.
 *
 * @param value Text value to normalize and truncate.
 * @param max Maximum preview length.
 * @returns A compact preview string.
 */
const truncateInline = (value: string, max = 120): string => {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= max) return normalized;
	return normalized.slice(0, max - 3) + "...";
};

/**
 * Truncates multiline content to a bounded payload size.
 *
 * @param value Content value to truncate.
 * @param max Maximum output length.
 * @returns Truncated block-safe string.
 */
const truncateBlock = (value: string, max = 900): string => {
	if (value.length <= max) return value;
	return value.slice(0, max - 3) + "...";
};

/**
 * Wraps content in a safe text code block for Discord embeds.
 *
 * @param value Raw content value.
 * @returns A Discord markdown code block.
 */
const toCodeBlock = (value: string): string => {
	const safe = value.replaceAll("```", "'''") || "[No content]";
	return `\`\`\`txt\n${safe}\n\`\`\``;
};
