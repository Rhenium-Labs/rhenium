import type { ModerationMultiModalInput, Moderation } from "openai/resources/moderations.mjs";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	hyperlink,
	Message,
	roleMention,
	TextBasedChannel,
	WebhookClient
} from "discord.js";

import ms from "ms";
import Tesseract from "node-tesseract-ocr";

import { CF_CONSTANTS } from "#utils/Constants.js";
import { openAi, kysely } from "#root/index.js";
import { userMentionWithId } from "#utils/index.js";
import { ContentFilterButtonNames, ContentFilterFieldNames, ScanType } from "./Enums.js";

import type { Detector } from "#database/Enums.js";
import type { ContentPredictionData, ContentPredictions } from "./Types.js";
import type { ParsedContentFilterConfig } from "#config/GuildConfig.js";

import Logger from "#utils/Logger.js";
import MediaUtils, { MessageMediaMetadata } from "#utils/Media.js";
import AutomatedScanner from "./AutomatedScanner.js";
import ContentFilterUtils from "#utils/ContentFilter.js";

export default class ContentFilter {
	/** OpenAI rate limit in milliseconds. */
	private static openAiRateLimitedUntil: number | null = null;

	/**
	 * Creates a content filter alert and sends it to the configured webhook.
	 *
	 * @param predictions The content predictions from detectors.
	 * @param scanType The type of scan that triggered the alert.
	 * @param message The message that triggered the alert.
	 * @param config The content filter configuration.
	 */
	static async createContentFilterAlert(
		predictions: ContentPredictions[],
		scanType: ScanType,
		message: Message<true>,
		config: ParsedContentFilterConfig
	): Promise<void> {
		if (!config.enabled || !config.webhook_url) return;

		// Calculate highest score and collect detectors used.
		let highestScore = 0;

		const detectorsUsed: Detector[] = [];
		const problematicContent: string[] = [];

		for (const prediction of predictions) {
			if (prediction.detector && !detectorsUsed.includes(prediction.detector)) {
				detectorsUsed.push(prediction.detector);
			}

			if (prediction.content) {
				problematicContent.push(...prediction.content);
			}

			for (const data of prediction.data) {
				if (data.score) {
					const score = parseFloat(data.score);
					if (score > highestScore) highestScore = score;
				}
			}
		}

		// Build scan results
		const scanResults: string[] = [];

		for (const prediction of predictions) {
			const detectorLabel = prediction.detector
				? `[${prediction.detector}]`
				: "[HEURISTIC]";
			for (const data of prediction.data) {
				const line = data.score
					? `${detectorLabel} ${data.content} (${data.score})`
					: `${detectorLabel} ${data.content}`;
				scanResults.push(line);
			}
		}

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setAuthor({ name: scanType })
			.setThumbnail(message.author.displayAvatarURL())
			.setTimestamp();

		// Add fields based on verbosity.
		const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

		fields.push({
			name: ContentFilterFieldNames.Offender,
			value: userMentionWithId(message.author.id),
			inline: true
		});

		fields.push({
			name: ContentFilterFieldNames.MessageLink,
			value: hyperlink("Jump to message", message.url),
			inline: true
		});

		fields.push({
			name: ContentFilterFieldNames.ResponseTime,
			value: ms(Date.now() - message.createdTimestamp, { long: true }),
			inline: true
		});

		// Add status fields
		fields.push({
			name: ContentFilterFieldNames.DelStatus,
			value: "Pending...",
			inline: true
		});

		fields.push({
			name: ContentFilterFieldNames.ModStatus,
			value: "Pending...",
			inline: true
		});

		// For Verbose/Medium verbosity, include scan results.
		if (config.verbosity !== "Minimal" && scanResults.length > 0) {
			const resultsStr = scanResults.slice(0, 10).join("\n");

			fields.push({
				name: ContentFilterFieldNames.ScanResults,
				value: resultsStr.length > 1024 ? resultsStr.slice(0, 1021) + "..." : resultsStr
			});
		}

		embed.addFields(fields);

		const deleteButton = new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.DelMessage)
			.setStyle(ButtonStyle.Danger)
			.setCustomId(`cf-delete-${message.id}-${message.channelId}`);

		const resolveButton = new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.Resolve)
			.setStyle(ButtonStyle.Success)
			.setCustomId(`cf-resolve-${message.id}`);

		const falseButton = new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.False)
			.setStyle(ButtonStyle.Secondary)
			.setCustomId(`cf-false-${message.channelId}`);

		const viewContentButton = new ButtonBuilder()
			.setLabel(ContentFilterButtonNames.Content)
			.setStyle(ButtonStyle.Primary)
			.setCustomId(`cf-content-${message.id}`);

		const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
			deleteButton,
			resolveButton,
			falseButton,
			viewContentButton
		);

		const notificationContent =
			config.notify_roles.length > 0
				? config.notify_roles.map(r => roleMention(r)).join(", ")
				: undefined;

		const webhook = new WebhookClient({ url: config.webhook_url });

		let alertMessageId: string | undefined;
		let alertChannelId: string | undefined;

		const alertMessage = await webhook
			.send({
				content: notificationContent,
				embeds: [embed],
				components: [actionRow],
				allowedMentions: { parse: ["roles"] }
			})
			.catch(() => null);

		if (!alertMessage) {
			return;
		}

		alertMessageId = alertMessage.id;
		alertChannelId = alertMessage.channel_id;

		const alert = await kysely
			.insertInto("ContentFilterAlert")
			.values({
				id: alertMessage.id,
				guild_id: message.guildId,
				message_id: message.id,
				channel_id: message.channelId,
				alert_message_id: alertMessageId,
				alert_channel_id: alertChannelId,
				offender_id: message.author.id,
				detectors: detectorsUsed,
				highest_score: highestScore,
				mod_status: "Pending",
				del_status: "Pending"
			})
			.returningAll()
			.executeTakeFirst();

		// Store flagged content for viewing later.
		if (problematicContent.length > 0) {
			const contentStr = problematicContent.join("\n---\n");
			await kysely
				.insertInto("ContentFilterLog")
				.values({
					id: alert!.id,
					guild_id: message.guildId,
					alert_id: alert!.id,
					content: contentStr
				})
				.execute();
		}

		// Update channel state for tracking
		const state = AutomatedScanner.getOrInitChannelState(message.channelId);
		state.alertCount++;
		state.scanTimestamps.push(Date.now());

		return webhook.destroy();
	}

	/**
	 * Scan a message using the specified detector.
	 *
	 * @param message The message to scan.
	 * @param detector The detector to use (NSFW, OCR, TEXT).
	 * @param config The content filter configuration.
	 * @returns The content predictions or null if no issues found.
	 */
	static async scanMessage(
		message: Message<true>,
		detector: Detector,
		config: ParsedContentFilterConfig
	): Promise<ContentPredictions | null> {
		const predictionData: ContentPredictionData[] = [];
		const problematicContent: string[] = [];

		switch (detector) {
			case "NSFW": {
				// Serialize and process media from the message.
				const media = await MediaUtils.serializeMedia(message, { validate: true });
				if (!media) break;

				const allMedia = MediaUtils.retrieveMedia(media);
				if (allMedia.length === 0) break;

				const processedMedia = await MediaUtils.processMedia(allMedia);
				if (processedMedia.length === 0) break;

				// Build multi-modal input for OpenAI.
				const multiModalInput = MediaUtils.serializeMultiModalInput(processedMedia);

				for (const item of multiModalInput)
					predictionData.push(...(await this.openAiScan([item], config, message)));
				problematicContent.push(...allMedia.map(metadata => metadata.url!));
				break;
			}
			case "OCR": {
				// Serialize and process media from the message.
				const media = await MediaUtils.serializeMedia(message, { validate: true });
				if (!media) break;

				const allMedia = MediaUtils.retrieveMedia(media);
				if (allMedia.length === 0) break;

				const processedMedia = await MediaUtils.processMedia(allMedia);
				if (processedMedia.length === 0) break;

				// Run OCR on each processed frame
				const ocrResults = await this._runOcrScan(processedMedia, config);
				predictionData.push(...ocrResults.predictions);
				problematicContent.push(...ocrResults.content);

				break;
			}
			case "TEXT": {
				if (message.content && message.content.length > 0) {
					const results = await this.openAiScan(message.content, config, message);
					predictionData.push(...results);

					if (results.length > 0) {
						problematicContent.push(message.content);
					}
				}
				break;
			}
		}

		return predictionData.length
			? { data: predictionData, detector, content: problematicContent }
			: null;
	}

	/**
	 * Run OCR scan on processed media.
	 *
	 * @param media The processed media metadata.
	 * @param config The content filter configuration.
	 * @return The OCR scan predictions and matched content.
	 */
	private static async _runOcrScan(
		media: MessageMediaMetadata[],
		config: ParsedContentFilterConfig
	): Promise<{ predictions: ContentPredictionData[]; content: string[] }> {
		const predictions: ContentPredictionData[] = [];
		const matchedContent: string[] = [];

		const keywords = config.ocr_filter_keywords ?? [];
		const regexPatterns = config.ocr_filter_regex ?? [];

		// Compile regex patterns.
		const compiledRegex: RegExp[] = [];
		for (const pattern of regexPatterns) {
			try {
				compiledRegex.push(new RegExp(pattern, "gi"));
			} catch {
				// Invalid regex, skip.
			}
		}

		for (const metadata of media) {
			if (!metadata.base64) continue;

			try {
				// Convert base64 to buffer for Tesseract.
				const buffer = Buffer.from(metadata.base64, "base64");

				// node-tesseract-ocr returns the text directly as a string.
				const text = await Tesseract.recognize(buffer, {
					lang: "eng"
				});

				const textLower = text.toLowerCase();

				// Check keywords.
				for (const keyword of keywords) {
					if (textLower.includes(keyword.toLowerCase())) {
						predictions.push({
							content: `OCR: Found keyword "${keyword}"`
						});
						matchedContent.push(keyword);
					}
				}

				// Check regex patterns.
				for (let i = 0; i < compiledRegex.length; i++) {
					const regex = compiledRegex[i];
					regex.lastIndex = 0; // Reset for each test
					if (regex.test(text)) {
						predictions.push({
							content: `OCR: Matched pattern "${regexPatterns[i]}"`
						});
						matchedContent.push(`Pattern: ${regexPatterns[i]}`);
					}
				}
			} catch (error) {
				// Skip OCR errors.
			}
		}

		return { predictions, content: matchedContent };
	}

	/**
	 * Perform OpenAI moderation scan on content.
	 *
	 * @param content The content to scan (text or multi-modal input).
	 * @param config The content filter configuration.
	 * @param message The message being scanned (optional).
	 * @returns The content prediction data.
	 */
	static async openAiScan(
		content: ModerationMultiModalInput[] | string,
		config: ParsedContentFilterConfig,
		message?: Message<true>
	): Promise<ContentPredictionData[]> {
		if (this.openAiRateLimitedUntil && Date.now() < this.openAiRateLimitedUntil) {
			return [];
		}

		const minScore = message
			? ContentFilterUtils.getMinScoreWithState(
					config,
					AutomatedScanner.getOrInitChannelState(message.channelId),
					message.author.id
				)
			: ContentFilterUtils.getMinScore(config);

		try {
			const results: Moderation[] = await ContentFilterUtils.retryWithBackoff(
				async () => {
					const res = await openAi.moderations.create({
						model: "omni-moderation-latest",
						input: content
					});
					return res.results;
				},
				{
					onRetry: (_, delay, error: unknown) => {
						if ((error as { status?: number })?.status === 429) {
							this.openAiRateLimitedUntil = Date.now() + delay;
						}
					}
				}
			);
			return this.parseOpenAiModerationResults(results, minScore);
		} catch (error: unknown) {
			if ((error as { status?: number })?.status === 429) {
				this.openAiRateLimitedUntil = Date.now() + CF_CONSTANTS.DEFAULT_FINAL_DELAY;
			}
			Logger.error("OpenAI moderation scan failed:", error);
			return [];
		}
	}

	/**
	 * Parse OpenAI moderation results into prediction data.
	 *
	 * @param results The OpenAI moderation results.
	 * @param minScore The minimum score threshold for flagging.
	 * @returns The content prediction data.
	 */
	static parseOpenAiModerationResults(
		results: Moderation[],
		minScore: number
	): ContentPredictionData[] {
		const predictions: ContentPredictionData[] = [];

		for (const result of results) {
			if (!result.flagged) continue;

			for (const category in result.categories) {
				const idx = category as keyof Moderation["categories"];
				if (result.categories[idx] && result.category_scores[idx] >= minScore) {
					predictions.push({
						content: `⚠️ ${category}`,
						score: result.category_scores[idx].toFixed(2)
					});
				}
			}
		}

		return predictions;
	}

	/**
	 * Run all enabled detectors on a message.
	 *
	 * @param _channel The channel where the message was sent.
	 * @param message The message to scan.
	 * @param config The content filter configuration.
	 * @returns An array of content predictions from all detectors.
	 */
	static async runDetectors(
		_channel: TextBasedChannel,
		message: Message<true>,
		config: ParsedContentFilterConfig
	): Promise<ContentPredictions[]> {
		const predictions: ContentPredictions[] = [];

		// Check if the author is a bot
		if (message.author.bot) return predictions;

		// Check if the author has immune roles
		if (config.immune_roles && config.immune_roles.length > 0) {
			try {
				const member = await message.guild.members
					.fetch(message.author.id)
					.catch(() => null);
				if (member && member.roles.cache.hasAny(...config.immune_roles)) {
					return predictions;
				}
			} catch {
				// If we can't fetch the member, continue with scanning
			}
		}

		await Promise.all(
			config.detectors.map(async detector => {
				const prediction = await this.scanMessage(message, detector, config);
				if (prediction) predictions.push(prediction);
			})
		);

		return predictions;
	}
}
