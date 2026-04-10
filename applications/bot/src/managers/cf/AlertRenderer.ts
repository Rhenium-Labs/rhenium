import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	hyperlink,
	roleMention,
	type Message,
	type WebhookMessageCreateOptions
} from "discord.js";

import ms from "ms";

import { userMentionWithId } from "#utils/index.js";

import {
	ContentFilterButtonNames,
	ContentFilterCustomIds,
	ContentFilterFieldNames
} from "./Enums.js";

import type { Detector } from "@repo/db";
import type { ParsedContentFilterConfig } from "#config/GuildConfig.js";
import type { ContentPredictions } from "./Types.js";

/**
 * Serialized payload and metadata produced when rendering a CF alert.
 */
export type AlertRenderResult = {
	payload: WebhookMessageCreateOptions;
	detectorsUsed: Detector[];
	highestScore: number;
	problematicContent: string[];
};

/**
 * Builds the content-filter alert payload and associated metadata.
 *
 * @param predictions Detector predictions generated for the flagged message.
 * @param scanType Human-readable scan source label for embed author text.
 * @param message The original Discord message that triggered the alert.
 * @param config Parsed content-filter configuration for the guild.
 * @returns Rendered webhook payload plus detector/content metadata for persistence.
 */
export function buildAlertPayload(
	predictions: ContentPredictions[],
	scanType: string,
	message: Message<true>,
	config: ParsedContentFilterConfig
): AlertRenderResult {
	let highestScore = 0;
	const detectorsUsed: Detector[] = [];
	const problematicContent: string[] = [];
	const findings: string[] = [];

	for (const prediction of predictions) {
		if (prediction.detector && !detectorsUsed.includes(prediction.detector)) {
			detectorsUsed.push(prediction.detector);
		}

		if (prediction.content) {
			problematicContent.push(...prediction.content);
		}

		const detectorLabel = prediction.detector ? `[${prediction.detector}]` : "[HEURISTIC]";
		for (const data of prediction.data) {
			if (data.score) {
				const score = Number.parseFloat(data.score);
				if (Number.isFinite(score) && score > highestScore) {
					highestScore = score;
				}
			}

			const line = data.score
				? `${detectorLabel} ${data.content} (${data.score})`
				: `${detectorLabel} ${data.content}`;
			findings.push(line);
		}
	}

	const responseTime = ms(Date.now() - message.createdTimestamp, { long: true });

	const embed = new EmbedBuilder()
		.setColor(Colors.Blue)
		.setAuthor({ name: `${scanType} | ${responseTime}` })
		.setThumbnail(message.author.displayAvatarURL())
		.setTimestamp()
		.addFields(
			{
				name: ContentFilterFieldNames.Offender,
				value: userMentionWithId(message.author.id)
			},
			{
				name: ContentFilterFieldNames.MessageLink,
				value: hyperlink("Jump to message", message.url)
			}
		);

	if (config.verbosity !== "Minimal" && findings.length > 0) {
		const findingsPreview = findings.slice(0, 12).join("\n");
		embed.addFields({
			name: ContentFilterFieldNames.ScanResults,
			value:
				findingsPreview.length > 1024
					? findingsPreview.slice(0, 1021) + "..."
					: findingsPreview
		});
	}

	const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.DelMessage)
			.setStyle(ButtonStyle.Danger)
			.setCustomId(ContentFilterCustomIds.del(message.id, message.channelId)),
		new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.Resolve)
			.setStyle(ButtonStyle.Success)
			.setCustomId(ContentFilterCustomIds.resolve(message.id)),
		new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.False)
			.setStyle(ButtonStyle.Secondary)
			.setCustomId(ContentFilterCustomIds.falsePositive(message.channelId, message.id)),
		new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.Content)
			.setStyle(ButtonStyle.Primary)
			.setCustomId(ContentFilterCustomIds.content(message.id))
	);

	const notificationContent =
		config.notify_roles.length > 0
			? config.notify_roles.map(roleId => roleMention(roleId)).join(", ")
			: undefined;

	return {
		payload: {
			content: notificationContent,
			embeds: [embed],
			components: [buttons],
			allowedMentions: { parse: ["roles"] }
		},
		detectorsUsed,
		highestScore,
		problematicContent
	};
}
