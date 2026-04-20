import type { ModerationMultiModalInput, Moderation } from "openai/resources/moderations";
import { WebhookClient, type Message, type Snowflake, type TextBasedChannel } from "discord.js";
import ms from "ms";

import sharp from "sharp";
import Tesseract from "node-tesseract-ocr";

import { client, openAi, kysely } from "#root/index.js";
import { buildAlertPayload as renderAlertPayload } from "./AlertRenderer.js";
import { Extensions } from "#utils/Media.js";

import ModerationUtils from "#utils/Moderation.js";

import type { Detector } from "@repo/db";
import type { ParsedContentFilterConfig } from "#config/GuildConfig.js";
import type { ChannelScanState, ContentPredictionData, ContentPredictions } from "./Types.js";
import type { MessageMediaMetadata } from "#utils/Media.js";

import ContentFilterUtils from "#utils/ContentFilter.js";
import Logger from "#utils/Logger.js";
import MediaUtils from "#utils/Media.js";

const NSFW_MIN_SCORE_ADJUSTMENT = -0.12;
const NSFW_STRICT_MAX_MIN_SCORE = 0.01;
const NSFW_ALLOWED_CATEGORY_PREFIXES = ["sexual"];
const MAX_MEDIA_FRAMES = 10;
const OPENAI_MODERATION_MAX_IMAGES_PER_REQUEST = 1;
const OPENAI_MODERATION_MAX_CONCURRENCY = 5;
const OPENAI_REQUEST_MAX_RETRIES = 3;
const OPENAI_RETRY_INITIAL_DELAY_MS = 500;
const OPENAI_RETRY_MAX_DELAY_MS = 15_000;
const OPENAI_HARD_RATE_LIMIT_COOLDOWN_MS = 30_000;

type PreAlertActionsResult = {
	flags: string[];
	disableDeleteButton: boolean;
	deletedBeforeAlert: boolean;
};

type DetectorActionPlan = {
	deleteMessage: boolean;
	timeoutDurationMs: number | null;
	triggeredDetectors: Detector[];
};

/**
 * Retryable error used to indicate scanner failures that should be requeued.
 */
export class RetryableScanError extends Error {
	readonly retryAfterMs?: number;

	/**
	 * Creates a retryable scan error with optional retry delay.
	 *
	 * @param message Error message.
	 * @param retryAfterMs Optional delay hint before retrying.
	 */
	constructor(message: string, retryAfterMs?: number) {
		super(message);
		this.name = "RetryableScanError";
		this.retryAfterMs = retryAfterMs;
	}
}

/**
 * Runs detector pipelines and persists moderation alerts.
 */
export default class ContentFilter {
	private static _openAiRateLimitedUntil: number | null = null;
	private static _openAiInFlightRequests = 0;
	private static _openAiWaitQueue: Array<() => void> = [];

	/**
	 * Returns remaining global OpenAI moderation cooldown in milliseconds.
	 *
	 * @returns Remaining cooldown, or zero when moderation is not paused.
	 */
	static getOpenAiRateLimitCooldownMs(): number {
		if (!this._openAiRateLimitedUntil) return 0;

		const remaining = this._openAiRateLimitedUntil - Date.now();

		if (remaining <= 0) {
			this._openAiRateLimitedUntil = null;
			return 0;
		}

		return remaining;
	}

	/**
	 * Delegates alert rendering to the alert renderer module.
	 *
	 * @param predictions Detector predictions for the message.
	 * @param scanType Human-readable scan type label.
	 * @param message Source message.
	 * @param config Parsed content-filter configuration.
	 * @returns Rendered payload and metadata for persistence.
	 */
	static buildAlertPayload(
		predictions: ContentPredictions[],
		scanType: string,
		message: Message<true>,
		config: ParsedContentFilterConfig,
		options?: {
			flags?: string[];
			disableDeleteButton?: boolean;
		}
	): {
		payload: ReturnType<typeof renderAlertPayload>["payload"];
		detectorsUsed: Detector[];
		highestScore: number;
		problematicContent: string[];
	} {
		return renderAlertPayload(predictions, scanType, message, config, options);
	}

	/**
	 * Creates and stores a content-filter alert from detector predictions.
	 *
	 * @param predictions Detector predictions for the message.
	 * @param scanType Human-readable scan type label.
	 * @param message Source message.
	 * @param config Parsed content-filter configuration.
	 */
	static async createContentFilterAlert(
		predictions: ContentPredictions[],
		scanType: string,
		message: Message<true>,
		config: ParsedContentFilterConfig
	): Promise<void> {
		if (!config.enabled || !config.webhook_url) return;

		const preAlertActions = await this._applyPreAlertActions(message, predictions, config);

		const { payload, detectorsUsed, highestScore, problematicContent } =
			this.buildAlertPayload(predictions, scanType, message, config, {
				flags: preAlertActions.flags,
				disableDeleteButton: preAlertActions.disableDeleteButton
			});

		const webhook = new WebhookClient({ url: config.webhook_url });
		const alertMessage = await webhook.send(payload).catch(error => {
			throw new RetryableScanError(
				`Webhook dispatch failed: ${toErrorString(error)}`,
				20_000
			);
		});

		if (!alertMessage) return;

		const alert = await kysely
			.insertInto("ContentFilterAlert")
			.values({
				id: alertMessage.id,
				guild_id: message.guildId,
				message_id: message.id,
				channel_id: message.channelId,
				alert_message_id: alertMessage.id,
				alert_channel_id: alertMessage.channel_id,
				offender_id: message.author.id,
				detectors: detectorsUsed,
				highest_score: highestScore,
				mod_status: "Pending",
				del_status: preAlertActions.deletedBeforeAlert ? "Deleted" : "Pending"
			})
			.returning(["id"])
			.executeTakeFirst();

		if (alert && problematicContent.length > 0) {
			await kysely
				.insertInto("ContentFilterLog")
				.values({
					id: alert.id,
					guild_id: message.guildId,
					alert_id: alert.id,
					content: problematicContent.join("\n---\n")
				})
				.execute();
		}

		webhook.destroy();
	}

	/**
	 * Runs all configured detectors and merges successful prediction output.
	 *
	 * @param _channel Message channel context (reserved for parity).
	 * @param message Source message.
	 * @param config Parsed content-filter configuration.
	 * @param state Optional channel scan state used by adaptive scoring.
	 * @param prefetchedTextResult Optional pre-fetched OpenAI moderation results for TEXT detector.
	 * @returns Combined detector predictions.
	 */
	static async runDetectors(
		_channel: TextBasedChannel,
		message: Message<true>,
		config: ParsedContentFilterConfig,
		state: ChannelScanState | null,
		prefetchedTextResult?: Moderation[],
		bypassOpenAiCooldown = false
	): Promise<ContentPredictions[]> {
		const predictions: ContentPredictions[] = [];
		if (message.author.bot) return predictions;

		const isImmune = await this._isImmuneAuthor(message, config);
		if (isImmune) return predictions;

		const failures: string[] = [];
		let openAiRateLimitRetryAfterMs: number | undefined;

		const detectorResults = await Promise.allSettled(
			config.detectors.map(async detector => {
				return this.scanMessage(
					message,
					detector,
					config,
					state,
					prefetchedTextResult,
					bypassOpenAiCooldown
				);
			})
		);

		for (const result of detectorResults) {
			if (result.status === "fulfilled") {
				if (result.value) predictions.push(result.value);
				continue;
			}

			if (isOpenAiRateLimitError(result.reason)) {
				const retryAfter = getRetryAfterMs(result.reason);
				if (
					typeof retryAfter === "number" &&
					(openAiRateLimitRetryAfterMs === undefined ||
						retryAfter > openAiRateLimitRetryAfterMs)
				) {
					openAiRateLimitRetryAfterMs = retryAfter;
				}

				failures.push("OpenAI moderation rate-limited");
				continue;
			}

			failures.push(toErrorMessage(result.reason));
		}

		if (failures.length > 0) {
			if (openAiRateLimitRetryAfterMs !== undefined) {
				throw new RetryableScanError(
					"OpenAI moderation rate-limited",
					openAiRateLimitRetryAfterMs
				);
			}

			throw new RetryableScanError(
				`One or more detectors failed: ${failures.join(" | ")}`
			);
		}

		return predictions;
	}

	/**
	 * Executes a single batched OpenAI moderation request for many text inputs.
	 *
	 * @param inputs Text payloads ordered by caller-provided index.
	 * @param _config Optional config placeholder for API parity.
	 * @param _state Optional channel state placeholder for API parity.
	 * @param _authorId Optional author identifier placeholder for API parity.
	 * @param options Optional retry controls for callers that prefer fast failure.
	 * @returns Moderation results preserving input ordering.
	 */
	static async batchScanText(
		inputs: string[],
		_config?: ParsedContentFilterConfig,
		_state?: ChannelScanState | null,
		_authorId?: Snowflake,
		options?: { maxRetries?: number }
	): Promise<Moderation[]> {
		if (inputs.length === 0) return [];

		const cooldownMs = this.getOpenAiRateLimitCooldownMs();
		if (cooldownMs > 0) {
			throw new RetryableScanError(
				"OpenAI moderation temporarily rate-limited",
				Math.max(1000, cooldownMs)
			);
		}

		try {
			const results = await ContentFilterUtils.retryWithBackoff(
				async () => {
					const currentCooldown = this.getOpenAiRateLimitCooldownMs();
					if (currentCooldown > 0) {
						throw new RetryableScanError(
							"OpenAI moderation temporarily rate-limited",
							Math.max(1000, currentCooldown)
						);
					}

					await this._acquireOpenAiRequestSlot();
					try {
						const response = await openAi.moderations.create({
							model: "omni-moderation-latest",
							input: inputs
						});

						return response.results;
					} finally {
						this._releaseOpenAiRequestSlot();
					}
				},
				{
					maxRetries: Math.max(1, options?.maxRetries ?? OPENAI_REQUEST_MAX_RETRIES),
					initialDelay: OPENAI_RETRY_INITIAL_DELAY_MS,
					backoffFactor: 2,
					maxDelay: OPENAI_RETRY_MAX_DELAY_MS,
					shouldRetry: isRetryableOpenAiError,
					onRetry: (_, delay, error: unknown) => {
						const retryAfter = getRetryAfterMs(error);
						if (typeof retryAfter === "number") {
							this._openAiRateLimitedUntil = Date.now() + retryAfter;
							return;
						}

						if ((error as { status?: number })?.status === 429) {
							this._openAiRateLimitedUntil = Date.now() + delay;
						}
					}
				}
			);

			return results;
		} catch (error: unknown) {
			if (error instanceof RetryableScanError) {
				throw error;
			}

			if ((error as { status?: number })?.status === 429) {
				const retryAfter = getRetryAfterMs(error) ?? OPENAI_HARD_RATE_LIMIT_COOLDOWN_MS;
				this._openAiRateLimitedUntil = Date.now() + retryAfter;
				throw new RetryableScanError("OpenAI moderation hard rate limit", retryAfter);
			}

			if (isRetryableOpenAiError(error)) {
				throw new RetryableScanError(
					`OpenAI moderation failed: ${toErrorString(error)}`,
					20_000
				);
			}

			throw new Error(`OpenAI moderation failed: ${toErrorString(error)}`);
		}
	}

	/**
	 * Runs a single detector for the provided message.
	 *
	 * @param message Source message.
	 * @param detector Detector identifier.
	 * @param config Parsed content-filter configuration.
	 * @param state Optional channel scan state used by adaptive scoring.
	 * @returns Detector prediction result or null when no matches were found.
	 */
	static async scanMessage(
		message: Message<true>,
		detector: Detector,
		config: ParsedContentFilterConfig,
		state: ChannelScanState | null,
		prefetchedTextResult?: Moderation[],
		bypassOpenAiCooldown = false
	): Promise<ContentPredictions | null> {
		const predictionData: ContentPredictionData[] = [];
		const problematicContent: string[] = [];

		switch (detector) {
			case "TEXT": {
				if (!message.content || message.content.length === 0) {
					break;
				}

				const minScore =
					state && message.author.id
						? ContentFilterUtils.getMinScoreWithState(
								config,
								state,
								message.author.id
							)
						: ContentFilterUtils.getMinScore(config);

				const results = prefetchedTextResult
					? this.parseOpenAiModerationResults(prefetchedTextResult, minScore)
					: await this.openAiScan(message.content, config, {
							state,
							authorId: message.author.id,
							ignoreCooldown: bypassOpenAiCooldown
						});
				predictionData.push(...results);

				if (results.length > 0) {
					problematicContent.push(message.content);
				}
				break;
			}
			case "NSFW": {
				const mediaScan = await this._prepareMediaForScan(message);
				if (!mediaScan.frames.length) {
					if (mediaScan.mediaFound) {
						throw new RetryableScanError(
							"Media was found but no NSFW frames could be prepared",
							15_000
						);
					}
					break;
				}

				const scanInputs = MediaUtils.serializeMultiModalInput(
					mediaScan.frames.slice(0, MAX_MEDIA_FRAMES)
				);
				const chunks = chunkArray(scanInputs, OPENAI_MODERATION_MAX_IMAGES_PER_REQUEST);
				for (const [chunkIndex, chunk] of chunks.entries()) {
					const results = await this.openAiScan(chunk, config, {
						state,
						authorId: message.author.id,
						ignoreCooldown: bypassOpenAiCooldown,
						scoreAdjustment: NSFW_MIN_SCORE_ADJUSTMENT,
						maxMinScore:
							config.detector_mode === "Strict"
								? NSFW_STRICT_MAX_MIN_SCORE
								: undefined,
						allowedCategoryPrefixes: NSFW_ALLOWED_CATEGORY_PREFIXES,
						requireFlaggedResult: config.detector_mode !== "Strict",
						onResults: (
							rawResults,
							minScore,
							requireFlaggedResult,
							allowedCategoryPrefixes
						) => {
							this._logOpenAiImageModeration({
								message,
								config,
								results: rawResults,
								minScore,
								requireFlaggedResult,
								allowedCategoryPrefixes,
								chunkIndex,
								chunkCount: chunks.length,
								imageCount: chunk.length
							});
						}
					});
					predictionData.push(...results);
				}

				if (predictionData.length > 0) {
					problematicContent.push(...mediaScan.problematicContent);
				}
				break;
			}
			case "OCR": {
				const mediaScan = await this._prepareMediaForScan(message);
				if (!mediaScan.frames.length) {
					if (mediaScan.mediaFound) {
						Logger.warn(
							"CF OCR skipped: media exists but no OCR frames could be prepared."
						);
					}
					break;
				}

				try {
					const ocr = await this._runOcrScan(mediaScan.frames, config);
					predictionData.push(...ocr.predictions);
					problematicContent.push(...ocr.content);
				} catch (error) {
					Logger.warn(
						`CF OCR detector unavailable for message ${message.id}; skipping OCR this scan: ${toErrorString(error)}`
					);
				}
				break;
			}
		}

		if (predictionData.length === 0) {
			return null;
		}

		return {
			data: predictionData,
			detector,
			content: problematicContent
		};
	}

	/**
	 * Executes OpenAI moderation and maps results into prediction entries.
	 *
	 * @param content Text or multimodal content payload.
	 * @param config Parsed content-filter configuration.
	 * @param options Optional scan controls and callbacks.
	 * @returns Content prediction entries produced by moderation output.
	 */
	static async openAiScan(
		content: ModerationMultiModalInput[] | string,
		config: ParsedContentFilterConfig,
		options?: {
			state?: ChannelScanState | null;
			authorId?: Snowflake;
			ignoreCooldown?: boolean;
			scoreAdjustment?: number;
			maxMinScore?: number;
			allowedCategoryPrefixes?: string[];
			requireFlaggedResult?: boolean;
			onResults?: (
				results: Moderation[],
				minScore: number,
				requireFlaggedResult: boolean,
				allowedCategoryPrefixes?: string[]
			) => void;
		}
	): Promise<ContentPredictionData[]> {
		const cooldownMs = this.getOpenAiRateLimitCooldownMs();
		if (!options?.ignoreCooldown && cooldownMs > 0) {
			throw new RetryableScanError(
				"OpenAI moderation temporarily rate-limited",
				Math.max(1000, cooldownMs)
			);
		}

		let minScore =
			options?.state && options.authorId
				? ContentFilterUtils.getMinScoreWithState(
						config,
						options.state,
						options.authorId
					)
				: ContentFilterUtils.getMinScore(config);

		if (options?.scoreAdjustment) {
			minScore = Math.max(0, Math.min(0.99, minScore + options.scoreAdjustment));
		}

		if (typeof options?.maxMinScore === "number") {
			const cap = Math.max(0, Math.min(0.99, options.maxMinScore));
			minScore = Math.min(minScore, cap);
		}

		const requireFlaggedResult = options?.requireFlaggedResult ?? true;
		const allowedCategoryPrefixes = options?.allowedCategoryPrefixes;

		try {
			const results: Moderation[] = await ContentFilterUtils.retryWithBackoff(
				async () => {
					const currentCooldown = this.getOpenAiRateLimitCooldownMs();
					if (!options?.ignoreCooldown && currentCooldown > 0) {
						throw new RetryableScanError(
							"OpenAI moderation temporarily rate-limited",
							Math.max(1000, currentCooldown)
						);
					}

					await this._acquireOpenAiRequestSlot();
					try {
						const res = await openAi.moderations.create({
							model: "omni-moderation-latest",
							input: content
						});
						return res.results;
					} finally {
						this._releaseOpenAiRequestSlot();
					}
				},
				{
					maxRetries: OPENAI_REQUEST_MAX_RETRIES,
					initialDelay: OPENAI_RETRY_INITIAL_DELAY_MS,
					backoffFactor: 2,
					maxDelay: OPENAI_RETRY_MAX_DELAY_MS,
					shouldRetry: isRetryableOpenAiError,
					onRetry: (_, delay, error: unknown) => {
						const retryAfter = getRetryAfterMs(error);
						if (typeof retryAfter === "number") {
							this._openAiRateLimitedUntil = Date.now() + retryAfter;
							return;
						}

						if ((error as { status?: number })?.status === 429) {
							this._openAiRateLimitedUntil = Date.now() + delay;
						}
					}
				}
			);

			if (options?.onResults) {
				options.onResults(
					results,
					minScore,
					requireFlaggedResult,
					allowedCategoryPrefixes
				);
			}

			return this.parseOpenAiModerationResults(
				results,
				minScore,
				requireFlaggedResult,
				allowedCategoryPrefixes
			);
		} catch (error: unknown) {
			if (error instanceof RetryableScanError) {
				throw error;
			}

			if ((error as { status?: number })?.status === 429) {
				const retryAfter = getRetryAfterMs(error) ?? OPENAI_HARD_RATE_LIMIT_COOLDOWN_MS;
				this._openAiRateLimitedUntil = Date.now() + retryAfter;
				throw new RetryableScanError("OpenAI moderation hard rate limit", retryAfter);
			}

			if (isRetryableOpenAiError(error)) {
				throw new RetryableScanError(
					`OpenAI moderation failed: ${toErrorString(error)}`,
					20_000
				);
			}

			throw new Error(`OpenAI moderation failed: ${toErrorString(error)}`);
		}
	}

	/**
	 * Waits for an available OpenAI moderation concurrency slot.
	 */
	private static async _acquireOpenAiRequestSlot(): Promise<void> {
		while (this._openAiInFlightRequests >= OPENAI_MODERATION_MAX_CONCURRENCY) {
			await new Promise<void>(resolve => {
				this._openAiWaitQueue.push(resolve);
			});
		}

		this._openAiInFlightRequests++;
	}

	/**
	 * Releases an OpenAI moderation concurrency slot.
	 */
	private static _releaseOpenAiRequestSlot(): void {
		this._openAiInFlightRequests = Math.max(0, this._openAiInFlightRequests - 1);

		const next = this._openAiWaitQueue.shift();
		if (next) {
			next();
		}
	}

	/**
	 * Converts OpenAI moderation responses into detector prediction entries.
	 *
	 * @param results OpenAI moderation results.
	 * @param minScore Minimum category score threshold.
	 * @param requireFlaggedResult Whether top-level flagged gate is required.
	 * @param allowedCategoryPrefixes Optional category prefix allow-list.
	 * @returns Parsed prediction entries.
	 */
	static parseOpenAiModerationResults(
		results: Moderation[],
		minScore: number,
		requireFlaggedResult = true,
		allowedCategoryPrefixes?: string[]
	): ContentPredictionData[] {
		const predictions: ContentPredictionData[] = [];

		for (const result of results) {
			if (requireFlaggedResult && !result.flagged) continue;

			for (const category in result.categories) {
				const idx = category as keyof Moderation["categories"];
				if (!isCategoryAllowed(category, allowedCategoryPrefixes)) {
					continue;
				}

				const passesCategoryGate = requireFlaggedResult
					? Boolean(result.categories[idx])
					: true;

				if (passesCategoryGate && result.category_scores[idx] >= minScore) {
					predictions.push({
						content: `Flagged: ${category}`,
						score: result.category_scores[idx].toFixed(2),
						category
					});
				}
			}
		}

		return predictions;
	}

	/**
	 * Applies configured detector actions before sending a moderation alert.
	 *
	 * @param message Source message.
	 * @param predictions Detector predictions generated for the message.
	 * @param config Parsed content-filter configuration.
	 * @returns Pre-alert action outcomes used by alert rendering and persistence.
	 */
	private static async _applyPreAlertActions(
		message: Message<true>,
		predictions: ContentPredictions[],
		config: ParsedContentFilterConfig
	): Promise<PreAlertActionsResult> {
		const actionPlan = this._resolveDetectorActionPlan(predictions, config);
		const flags: string[] = [];

		let disableDeleteButton = false;
		let deletedBeforeAlert = false;

		if (actionPlan.timeoutDurationMs) {
			const timeoutApplied = await this._applyTimeoutAction(
				message,
				actionPlan.timeoutDurationMs,
				actionPlan.triggeredDetectors
			);

			if (timeoutApplied) {
				flags.push(
					`Offender Timed Out (${ms(actionPlan.timeoutDurationMs, { long: true })})`
				);
			}
		}

		if (actionPlan.deleteMessage) {
			const deleteResult = await this._applyDeleteAction(message);
			if (deleteResult === "deleted") {
				flags.push(`Message Deleted (by ${client.user})`);
				disableDeleteButton = true;
				deletedBeforeAlert = true;
			} else if (deleteResult === "missing") {
				disableDeleteButton = true;
				deletedBeforeAlert = true;
			}
		}

		if (!deletedBeforeAlert) {
			const stillExists = await message.channel.messages
				.fetch(message.id)
				.then(() => true)
				.catch(error => {
					const code = (error as { code?: number })?.code;
					if (code === 10008) return false;
					return true;
				});

			if (!stillExists) {
				disableDeleteButton = true;
				deletedBeforeAlert = true;
			}
		}

		return {
			flags,
			disableDeleteButton,
			deletedBeforeAlert
		};
	}

	/**
	 * Resolves aggregate detector action decisions for a prediction set.
	 *
	 * @param predictions Detector predictions generated for the message.
	 * @param config Parsed content-filter configuration.
	 * @returns Planned pre-alert actions.
	 */
	private static _resolveDetectorActionPlan(
		predictions: ContentPredictions[],
		config: ParsedContentFilterConfig
	): DetectorActionPlan {
		let deleteMessage = false;
		let timeoutDurationMs = 0;
		let applyNsfwActionsToText = false;

		const triggeredDetectors = new Set<Detector>();

		for (const prediction of predictions) {
			if (!prediction.detector) continue;

			triggeredDetectors.add(prediction.detector);

			const detectorActions = config.detector_actions[prediction.detector];
			if (detectorActions.delete_message) {
				deleteMessage = true;
			}

			if (detectorActions.timeout_user) {
				timeoutDurationMs = Math.max(
					timeoutDurationMs,
					detectorActions.timeout_duration_ms
				);
			}

			if (
				prediction.detector === "TEXT" &&
				config.detector_actions.NSFW.apply_to_text_nsfw &&
				this._predictionContainsTextNsfw(prediction)
			) {
				applyNsfwActionsToText = true;
			}
		}

		if (applyNsfwActionsToText) {
			const nsfwActions = config.detector_actions.NSFW;

			if (nsfwActions.delete_message) {
				deleteMessage = true;
			}

			if (nsfwActions.timeout_user) {
				timeoutDurationMs = Math.max(
					timeoutDurationMs,
					nsfwActions.timeout_duration_ms
				);
			}
		}

		return {
			deleteMessage,
			timeoutDurationMs: timeoutDurationMs > 0 ? timeoutDurationMs : null,
			triggeredDetectors: [...triggeredDetectors]
		};
	}

	/**
	 * Checks whether a TEXT detector prediction includes NSFW (sexual) categories.
	 *
	 * @param prediction The prediction to evaluate.
	 * @returns True when at least one sexual category was detected.
	 */
	private static _predictionContainsTextNsfw(prediction: ContentPredictions): boolean {
		return prediction.data.some(item => {
			const normalizedCategory = item.category?.toLowerCase();
			if (normalizedCategory) {
				return (
					normalizedCategory === "sexual" || normalizedCategory.startsWith("sexual/")
				);
			}

			const normalizedContent = item.content.toLowerCase();
			return normalizedContent.includes("flagged: sexual");
		});
	}

	/**
	 * Attempts to timeout the offending member using configured detector actions.
	 *
	 * @param message Source message.
	 * @param timeoutDurationMs Timeout duration in milliseconds.
	 * @param triggeredDetectors Detectors that triggered the scan result.
	 * @returns True when timeout was applied successfully.
	 */
	private static async _applyTimeoutAction(
		message: Message<true>,
		timeoutDurationMs: number,
		triggeredDetectors: Detector[]
	): Promise<boolean> {
		const botMember = message.guild.members.me;
		if (!botMember) return false;

		if (!message.channel.permissionsFor(botMember)?.has("ModerateMembers")) {
			return false;
		}

		const target =
			message.member ??
			(await message.guild.members.fetch(message.author.id).catch(() => null));

		if (!target || target.isCommunicationDisabled()) {
			return false;
		}

		const validation = ModerationUtils.validateAction(target, botMember, "Mute");

		if (!validation.ok) {
			return false;
		}

		const detectorSummary =
			triggeredDetectors.length > 0 ? triggeredDetectors.join(", ") : "unknown";

		const reason = this._truncateReason(
			`Automatic timeout from content filter (${detectorSummary})`
		);

		return target
			.timeout(timeoutDurationMs, reason)
			.then(() => true)
			.catch(() => {
				Logger.warn(`CF pre-alert timeout failed for user ${target.id}.`);
				return false;
			});
	}

	/**
	 * Attempts to delete the offending message before sending an alert.
	 *
	 * @param message Source message.
	 * @returns Delete outcome state.
	 */
	private static async _applyDeleteAction(
		message: Message<true>
	): Promise<"deleted" | "missing" | "failed"> {
		return message
			.delete()
			.then(() => "deleted" as const)
			.catch(error => {
				const code = (error as { code?: number })?.code;
				if (code === 10008) {
					return "missing" as const;
				}

				Logger.warn(
					`CF pre-alert delete failed for message ${message.id}: ${toErrorString(error)}`
				);
				return "failed" as const;
			});
	}

	/**
	 * Truncates moderation action reasons to Discord's 512-char limit.
	 *
	 * @param reason Raw reason text.
	 * @returns Truncated reason.
	 */
	private static _truncateReason(reason: string): string {
		if (reason.length <= 512) return reason;
		return `${reason.slice(0, 509)}...`;
	}

	/**
	 * Checks whether the message author is immune from content-filter processing.
	 *
	 * @param message Source message.
	 * @param config Parsed content-filter configuration.
	 * @returns True when the author has an immune role.
	 */
	private static async _isImmuneAuthor(
		message: Message<true>,
		config: ParsedContentFilterConfig
	): Promise<boolean> {
		if (!config.immune_roles || config.immune_roles.length === 0) {
			return false;
		}

		const memberFromMessage = message.member;
		if (memberFromMessage?.roles.cache.hasAny(...config.immune_roles)) {
			return true;
		}

		try {
			const member = await message.guild.members
				.fetch(message.author.id)
				.catch(() => null);
			return !!member && member.roles.cache.hasAny(...config.immune_roles);
		} catch {
			return false;
		}
	}

	/**
	 * Extracts processable media frames and source metadata for detector scans.
	 *
	 * @param message Source message.
	 * @returns Prepared frame payload and media metadata flags.
	 */
	private static async _prepareMediaForScan(message: Message<true>): Promise<{
		frames: MessageMediaMetadata[];
		problematicContent: string[];
		mediaFound: boolean;
	}> {
		const media = await MediaUtils.serializeMedia(message, { validate: true });
		if (!media) {
			return { frames: [], problematicContent: [], mediaFound: false };
		}

		const allMedia = MediaUtils.retrieveMedia(media);
		if (allMedia.length === 0) {
			return { frames: [], problematicContent: [], mediaFound: false };
		}

		const primaryFrames = await MediaUtils.processMedia(allMedia);
		if (primaryFrames.length > 0) {
			return {
				frames: primaryFrames,
				problematicContent: allMedia.map(item => item.url ?? "unknown"),
				mediaFound: true
			};
		}

		const fallbackFrames = await this._fallbackMediaConversion(allMedia);
		return {
			frames: fallbackFrames,
			problematicContent: allMedia.map(item => item.url ?? "unknown"),
			mediaFound: true
		};
	}

	/**
	 * Performs fallback media conversion when primary processing returns no frames.
	 *
	 * @param media Collected media metadata.
	 * @returns Converted media frames suitable for moderation/OCR pipelines.
	 */
	private static async _fallbackMediaConversion(
		media: MessageMediaMetadata[]
	): Promise<MessageMediaMetadata[]> {
		const frames: MessageMediaMetadata[] = [];

		for (const metadata of media) {
			if (!metadata.url) continue;

			try {
				const response = await fetch(metadata.url);
				if (!response.ok) continue;

				const contentType = response.headers.get("content-type") ?? "";
				const buffer = new Uint8Array(await response.arrayBuffer());
				const extension =
					metadata.extension ?? guessExtensionFromSource(metadata.url, contentType);

				if (extension) {
					const converted = await MediaUtils.mediaConversion(buffer, extension);
					if (converted.length > 0) {
						frames.push(...converted);
						continue;
					}
				}

				const pngBuffer = await sharp(buffer)
					.png()
					.resize({
						width: 512,
						height: 512,
						fit: "inside",
						withoutEnlargement: true
					})
					.toBuffer();

				frames.push({
					base64: pngBuffer.toString("base64"),
					extension: Extensions.PNG
				});
			} catch (error) {
				Logger.warn("CF media fallback conversion failed:", toErrorString(error));
			}
		}

		return frames;
	}

	/**
	 * Runs OCR over processed media frames and maps configured keyword/regex matches.
	 *
	 * @param media Processed media frames.
	 * @param config Parsed content-filter configuration.
	 * @returns OCR prediction entries and matched content snippets.
	 */
	private static async _runOcrScan(
		media: MessageMediaMetadata[],
		config: ParsedContentFilterConfig
	): Promise<{ predictions: ContentPredictionData[]; content: string[] }> {
		const predictions: ContentPredictionData[] = [];
		const matchedContent: string[] = [];

		const keywords = config.ocr_filter_keywords ?? [];
		const regexPatterns = config.ocr_filter_regex ?? [];
		const compiledRegex = regexPatterns.flatMap(pattern => {
			try {
				return [new RegExp(pattern, "gi")];
			} catch {
				return [];
			}
		});

		let frameFailures = 0;

		for (const metadata of media) {
			if (!metadata.base64) continue;

			try {
				const buffer = Buffer.from(metadata.base64, "base64");
				const text = await Tesseract.recognize(buffer, { lang: "eng" });
				const lower = text.toLowerCase();

				for (const keyword of keywords) {
					if (lower.includes(keyword.toLowerCase())) {
						predictions.push({ content: `OCR keyword match: \"${keyword}\"` });
						matchedContent.push(keyword);
					}
				}

				for (let i = 0; i < compiledRegex.length; i++) {
					const regex = compiledRegex[i];
					regex.lastIndex = 0;
					if (regex.test(text)) {
						predictions.push({
							content: `OCR regex match: \"${regexPatterns[i]}\"`
						});
						matchedContent.push(`Pattern: ${regexPatterns[i]}`);
					}
				}
			} catch {
				frameFailures++;
			}
		}

		if (media.length > 0 && frameFailures >= media.length) {
			throw new RetryableScanError("OCR failed for all prepared frames", 15_000);
		}

		return { predictions, content: matchedContent };
	}

	/**
	 * Logs NSFW moderation telemetry for calibration and diagnostics.
	 *
	 * @param data Moderation result context and logging metadata.
	 */
	private static _logOpenAiImageModeration(data: {
		message: Message<true>;
		config: ParsedContentFilterConfig;
		results: Moderation[];
		minScore: number;
		requireFlaggedResult: boolean;
		allowedCategoryPrefixes?: string[];
		chunkIndex: number;
		chunkCount: number;
		imageCount: number;
	}): void {
		const categoryLimit = data.config.verbosity === "Verbose" ? 6 : 3;
		const summaries = data.results.map(result =>
			summarizeModerationResult(
				result,
				data.minScore,
				categoryLimit,
				data.requireFlaggedResult,
				data.allowedCategoryPrefixes
			)
		);

		const flaggedResults = summaries.filter(summary => summary.flagged).length;
		const triggeredCategories = summaries.reduce(
			(count, summary) => count + summary.triggered.length,
			0
		);

		const highestSexualScore = Number(
			Math.max(
				...data.results.map(result => getCategoryScore(result, "sexual")),
				0
			).toFixed(3)
		);
		const highestSexualMinorsScore = Number(
			Math.max(
				...data.results.map(result => getCategoryScore(result, "sexual/minors")),
				0
			).toFixed(3)
		);

		const payload: {
			event: string;
			guildId: string;
			channelId: string;
			messageId: string;
			mode: string;
			categoryScope: string;
			chunk: string;
			imagesInChunk: number;
			minScore: number;
			requireFlaggedResult: boolean;
			flaggedResults: number;
			resultCount: number;
			triggeredCategories: number;
			highestSexualScore: number;
			highestSexualMinorsScore: number;
			results?: Array<{ flagged: boolean; top: string[]; triggered: string[] }>;
		} = {
			event: "openai_nsfw_scores",
			guildId: data.message.guildId,
			channelId: data.message.channelId,
			messageId: data.message.id,
			mode: data.config.detector_mode,
			categoryScope: (data.allowedCategoryPrefixes ?? ["all"]).join(","),
			chunk: `${data.chunkIndex + 1}/${data.chunkCount}`,
			imagesInChunk: data.imageCount,
			minScore: Number(data.minScore.toFixed(3)),
			requireFlaggedResult: data.requireFlaggedResult,
			flaggedResults,
			resultCount: data.results.length,
			triggeredCategories,
			highestSexualScore,
			highestSexualMinorsScore
		};

		if (data.config.verbosity !== "Minimal") {
			payload.results = summaries;
		}

		Logger.custom("CF", JSON.stringify(payload));
	}
}

/**
 * Splits an array into evenly-sized chunks.
 *
 * @param items Input array.
 * @param chunkSize Requested chunk size.
 * @returns Chunked item arrays.
 */
function chunkArray<T>(items: T[], chunkSize: number): T[][] {
	const size = Math.max(1, chunkSize);
	const chunks: T[][] = [];

	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}

	return chunks;
}

/**
 * Builds a compact summary of a moderation result for telemetry.
 *
 * @param result OpenAI moderation result.
 * @param minScore Minimum score threshold.
 * @param categoryLimit Maximum number of categories to include.
 * @param requireFlaggedResult Whether top-level flagged gate is required.
 * @param allowedCategoryPrefixes Optional category allow-list prefixes.
 * @returns Condensed moderation summary.
 */
function summarizeModerationResult(
	result: Moderation,
	minScore: number,
	categoryLimit: number,
	requireFlaggedResult: boolean,
	allowedCategoryPrefixes?: string[]
): { flagged: boolean; top: string[]; triggered: string[] } {
	const entries = Object.entries(result.category_scores)
		.map(([category, rawScore]) => ({
			category,
			score: Number(rawScore ?? 0)
		}))
		.filter(({ category }) => isCategoryAllowed(category, allowedCategoryPrefixes))
		.sort((a, b) => b.score - a.score);

	const top = entries
		.slice(0, categoryLimit)
		.map(({ category, score }) => `${category}:${score.toFixed(3)}`);

	const triggered = entries
		.filter(({ category, score }) => {
			const key = category as keyof Moderation["categories"];
			const passesCategoryGate = requireFlaggedResult
				? Boolean(result.categories[key])
				: true;
			return passesCategoryGate && score >= minScore;
		})
		.slice(0, categoryLimit)
		.map(({ category, score }) => `${category}:${score.toFixed(3)}`);

	return {
		flagged: result.flagged,
		top,
		triggered
	};
}

/**
 * Checks whether a moderation category is in the allowed scope.
 *
 * @param category Category name.
 * @param allowedCategoryPrefixes Optional allow-list prefixes.
 * @returns True when the category should be evaluated.
 */
function isCategoryAllowed(category: string, allowedCategoryPrefixes?: string[]): boolean {
	if (!allowedCategoryPrefixes || allowedCategoryPrefixes.length === 0) {
		return true;
	}

	return allowedCategoryPrefixes.some(
		prefix => category === prefix || category.startsWith(`${prefix}/`)
	);
}

/**
 * Retrieves a category score from a moderation result.
 *
 * @param result OpenAI moderation result.
 * @param category Category key.
 * @returns Score value or zero when unavailable.
 */
function getCategoryScore(result: Moderation, category: string): number {
	for (const [name, rawScore] of Object.entries(result.category_scores)) {
		if (name === category) {
			return Number(rawScore ?? 0);
		}
	}

	return 0;
}

/**
 * Attempts to infer media extension from URL path or content-type.
 *
 * @param url Source media URL.
 * @param contentType Response content-type header.
 * @returns Inferred extension or null.
 */
function guessExtensionFromSource(url: string, contentType: string): Extensions | null {
	const normalizedType = contentType.toLowerCase();

	if (normalizedType.includes("image/png")) return Extensions.PNG;
	if (normalizedType.includes("image/jpeg")) return Extensions.JPEG;
	if (normalizedType.includes("image/jpg")) return Extensions.JPG;
	if (normalizedType.includes("image/gif")) return Extensions.GIF;
	if (normalizedType.includes("image/webp")) return Extensions.WEBP;
	if (normalizedType.includes("image/bmp")) return Extensions.BMP;
	if (normalizedType.includes("video/mp4")) return Extensions.MP4;
	if (normalizedType.includes("video/webm")) return Extensions.WEBM;
	if (normalizedType.includes("video/quicktime")) return Extensions.MOV;
	if (normalizedType.includes("video/x-msvideo")) return Extensions.AVI;

	const pathname = safePathname(url).toLowerCase();
	if (pathname.endsWith(".png")) return Extensions.PNG;
	if (pathname.endsWith(".jpeg")) return Extensions.JPEG;
	if (pathname.endsWith(".jpg")) return Extensions.JPG;
	if (pathname.endsWith(".gif")) return Extensions.GIF;
	if (pathname.endsWith(".webp")) return Extensions.WEBP;
	if (pathname.endsWith(".bmp")) return Extensions.BMP;
	if (pathname.endsWith(".jfif")) return Extensions.JFIF;
	if (pathname.endsWith(".mp4")) return Extensions.MP4;
	if (pathname.endsWith(".mov")) return Extensions.MOV;
	if (pathname.endsWith(".avi")) return Extensions.AVI;
	if (pathname.endsWith(".webm")) return Extensions.WEBM;

	return null;
}

/**
 * Safely extracts pathname from a URL-like value.
 *
 * @param url URL candidate.
 * @returns Parsed pathname or original value when parsing fails.
 */
function safePathname(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

/**
 * Serializes unknown errors into readable strings.
 *
 * @param error Unknown error value.
 * @returns Serialized error string.
 */
function toErrorString(error: unknown): string {
	if (!error) return "unknown";
	if (error instanceof Error) return error.stack ?? error.message;
	if (typeof error === "string") return error;

	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/**
 * Serializes unknown errors into concise, single-line text.
 *
 * @param error Unknown error value.
 * @returns Minimal error description without stack traces.
 */
function toErrorMessage(error: unknown): string {
	if (!error) return "unknown";
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;

	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/**
 * Determines whether an OpenAI moderation failure should be retried.
 *
 * @param error Unknown error value.
 * @returns True when the failure is likely transient.
 */
function isRetryableOpenAiError(error: unknown): boolean {
	if (error instanceof RetryableScanError) return true;

	const status = (error as { status?: unknown })?.status;
	if (typeof status === "number") {
		if (status === 408 || status === 409 || status === 425 || status === 429) {
			return true;
		}

		if (status >= 500 && status <= 599) {
			return true;
		}

		if (status >= 400 && status <= 499) {
			return false;
		}
	}

	const code = (error as { code?: unknown })?.code;
	if (typeof code === "string") {
		const normalizedCode = code.toLowerCase();
		if (
			normalizedCode.includes("rate") ||
			normalizedCode.includes("timeout") ||
			normalizedCode.includes("abort") ||
			normalizedCode.includes("econnreset") ||
			normalizedCode.includes("eai_again") ||
			normalizedCode.includes("enetunreach")
		) {
			return true;
		}
	}

	const message =
		error instanceof Error ? error.message : typeof error === "string" ? error : "";
	const name = error instanceof Error ? error.name.toLowerCase() : "";
	const normalizedMessage = message.toLowerCase();

	if (name === "aborterror" || name === "timeouterror") {
		return true;
	}

	return (
		normalizedMessage.includes("rate limit") ||
		normalizedMessage.includes("rate-limited") ||
		normalizedMessage.includes("timed out") ||
		normalizedMessage.includes("timeout") ||
		normalizedMessage.includes("aborterror") ||
		normalizedMessage.includes("network") ||
		normalizedMessage.includes("socket hang up") ||
		normalizedMessage.includes("temporarily unavailable")
	);
}

/**
 * Checks whether an error represents an OpenAI moderation rate-limit event.
 *
 * @param error Unknown error value.
 * @returns True when the error indicates OpenAI rate limiting.
 */
function isOpenAiRateLimitError(error: unknown): boolean {
	if ((error as { status?: number })?.status === 429) return true;

	const code = (error as { code?: unknown })?.code;
	if (typeof code === "string" && code.toLowerCase().includes("rate")) {
		return true;
	}

	const message =
		error instanceof Error ? error.message : typeof error === "string" ? error : "";
	const normalizedMessage = message.toLowerCase();

	return (
		normalizedMessage.includes("openai") &&
		(normalizedMessage.includes("rate limit") || normalizedMessage.includes("rate-limited"))
	);
}

/**
 * Extracts a retry-after hint from retryable errors when available.
 *
 * @param error Unknown error value.
 * @returns Retry delay in milliseconds, or undefined.
 */
function getRetryAfterMs(error: unknown): number | undefined {
	if (error instanceof RetryableScanError && typeof error.retryAfterMs === "number") {
		return Math.max(1000, error.retryAfterMs);
	}

	const readHeader = (headers: unknown, key: string): unknown => {
		if (!headers || typeof headers !== "object") {
			return undefined;
		}

		const maybeGetter = headers as { get?: unknown };
		if (typeof maybeGetter.get === "function") {
			return (
				(maybeGetter.get as (header: string) => unknown)(key) ??
				(maybeGetter.get as (header: string) => unknown)(key.toLowerCase())
			);
		}

		const record = headers as Record<string, unknown>;
		return record[key] ?? record[key.toLowerCase()];
	};

	const directHeaders = (error as { headers?: unknown })?.headers;
	const responseHeaders = (error as { response?: { headers?: unknown } })?.response?.headers;

	const candidates: unknown[] = [
		(error as { retryAfterMs?: unknown })?.retryAfterMs,
		(error as { retry_after?: unknown })?.retry_after,
		(error as { retryAfter?: unknown })?.retryAfter,
		(error as { error?: { retry_after?: unknown } })?.error?.retry_after,
		(error as { error?: { retryAfter?: unknown } })?.error?.retryAfter,
		readHeader(directHeaders, "retry-after"),
		readHeader(directHeaders, "x-ratelimit-reset-after"),
		readHeader(responseHeaders, "retry-after"),
		readHeader(responseHeaders, "x-ratelimit-reset-after")
	];

	for (const candidate of candidates) {
		if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
			const ms = candidate > 1000 ? candidate : candidate * 1000;
			return Math.max(1000, Math.round(ms));
		}

		if (typeof candidate === "string") {
			const parsed = Number.parseFloat(candidate);
			if (Number.isFinite(parsed) && parsed > 0) {
				const ms = parsed > 1000 ? parsed : parsed * 1000;
				return Math.max(1000, Math.round(ms));
			}
		}
	}

	const message =
		error instanceof Error ? error.message : typeof error === "string" ? error : "";
	const normalizedMessage = message.toLowerCase();
	const retryAfterMatch = normalizedMessage.match(
		/retry after\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|seconds)?/i
	);

	if (retryAfterMatch) {
		const raw = Number.parseFloat(retryAfterMatch[1] ?? "0");
		if (Number.isFinite(raw) && raw > 0) {
			const unit = (retryAfterMatch[2] ?? "s").toLowerCase();
			const multiplier = unit === "ms" ? 1 : 1000;
			return Math.max(1000, Math.round(raw * multiplier));
		}
	}

	return undefined;
}
