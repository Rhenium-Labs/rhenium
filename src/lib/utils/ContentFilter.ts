import type { Message, Snowflake, TextBasedChannel, TextChannel } from "discord.js";
import type { Moderation, ModerationMultiModalInput } from "openai/resources/moderations.js";
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors,
	EmbedBuilder,
	hyperlink,
	roleMention,
	WebhookClient
} from "discord.js";
import { distance } from "closest-match";

import Tesseract from "node-tesseract-ocr";

import { openAi, prisma } from "#root/index.js";
import {
	ContentFilterStatus,
	ContentFilterAlert,
	DetectorMode,
	type ContentFilterConfig,
	type Detector,
	type Message as SerializedMessage
} from "#prisma/client.js";
import { channelInScope, userMentionWithId } from "./index.js";
import { MessageQueue } from "./Messages.js";

import type { ChannelScoping } from "./Types.js";

import Logger from "./Logger.js";
import MinimumHeap from "#structures/MinimumHeap.js";
import MediaUtils, { type MessageMediaMetadata } from "./Media.js";
import ConfigManager from "#managers/config/ConfigManager.js";
import ms from "ms";

// ─────────────────────────────────────────────────────────────────────────────
// ContentFilterUtils
// ─────────────────────────────────────────────────────────────────────────────

export class ContentFilterUtils {
	/**
	 * Computes the risk score for a message based on its properties.
	 *
	 * @param config The content filter configuration.
	 * @param message The serialized message data.
	 * @returns The computed risk score.
	 */
	public static computeMessageRisk(config: ContentFilterConfig, message: SerializedMessage): number {
		const riskIncreaseStep =
			config.detector_mode === DetectorMode.Lenient
				? HEURISTIC_LENIENT_RISK_INCREASE
				: config.detector_mode === DetectorMode.Medium
					? HEURISTIC_MEDIUM_RISK_INCREASE
					: HEURISTIC_STRICT_RISK_INCREASE;

		let risk = HEURISTIC_BASE_RISK;

		if (message.attachments.length > 0) risk += riskIncreaseStep;
		if (message.reference_id) risk += riskIncreaseStep;

		return Math.min(risk, 1);
	}

	/** Retries a function with exponential backoff and jitter. */
	public static async retryWithBackoff<T>(
		fn: () => Promise<T>,
		options?: {
			maxRetries?: number;
			initialDelay?: number;
			backoffFactor?: number;
			maxDelay?: number;
			jitter?: boolean;
			onRetry?: (attempt: number, delay: number, error: unknown) => void;
		}
	): Promise<T> {
		const {
			maxRetries = DEFAULT_MAX_RETRIES,
			initialDelay = DEFAULT_INITIAL_DELAY,
			backoffFactor = DEFAULT_BACKOFF_FACTOR,
			maxDelay = DEFAULT_MAX_DELAY,
			jitter = true,
			onRetry
		} = options || {};

		let attempt = 0;
		let delay = initialDelay;
		let lastError: unknown;

		while (attempt < maxRetries) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;

				if (onRetry) onRetry(attempt, delay, error);
				if (attempt === maxRetries - 1) break;

				let sleep = delay;

				if (jitter) {
					sleep = Math.floor(delay * (1 + Math.random() * DEFAULT_RETRY_JITTER));
				}

				await new Promise(res => setTimeout(res, sleep));
				delay = Math.min(delay * backoffFactor, maxDelay);
				attempt++;
			}
		}

		throw lastError;
	}

	/**
	 * Gets the minimum score threshold based on detector mode.
	 *
	 * @param config The content filter configuration.
	 * @returns The minimum score threshold.
	 */
	public static getMinScore(config: ContentFilterConfig): number {
		let base =
			config.detector_mode === DetectorMode.Lenient
				? HEURISTIC_LENIENT_SCORE
				: config.detector_mode === DetectorMode.Medium
					? HEURISTIC_MEDIUM_SCORE
					: 0;

		return Math.max(0, Math.min(0.99, base));
	}

	/**
	 * Get the minimum score with channel state adjustments.
	 *
	 * @param config The content filter configuration.
	 * @param state The channel scan state.
	 * @param authorId The author's user ID.
	 * @returns The adjusted minimum score threshold.
	 */
	public static getMinScoreWithState(
		config: ContentFilterConfig,
		state: ChannelScanState | null,
		authorId: Snowflake
	): number {
		let base = this.getMinScore(config);

		if (state) {
			const smoothedFP = state.falsePositiveRatio ?? 0;
			base += smoothedFP * HEURISTIC_SCORE_FP_INFLUENCE;

			const now = Date.now();
			const userAlerts: number[] = state.flaggedUsers?.get(authorId) ?? [];
			const recentAlerts = userAlerts.filter(
				(ts: number) => now - ts <= HEURISTIC_USER_RECENT_ALERT_WINDOW_MS
			).length;
			const recentNormalized = Math.min(1, recentAlerts / 5);
			base -= recentNormalized * HEURISTIC_SCORE_USER_ALERT_INFLUENCE;
		}

		return Math.max(0, Math.min(0.99, base));
	}

	/**
	 * Fetches pending content filter alerts for a guild, optionally filtered by a creation time threshold.
	 *
	 * @param guildId The guild ID.
	 * @param threshold Optional date to filter alerts created before this time.
	 * @returns An array of pending ContentFilterAlert records.
	 */
	public static async fetchPendingAlerts(guildId: Snowflake, threshold?: Date): Promise<ContentFilterAlert[]> {
		return prisma.contentFilterAlert.findMany({
			where: {
				guild_id: guildId,
				mod_status: ContentFilterStatus.Pending,
				created_at: threshold ? { lt: threshold } : undefined
			},
			orderBy: {
				created_at: "asc"
			}
		});
	}

	/**
	 * Fetches recent content filter alerts for a guild and channel, and computes the false positive ratio.
	 *
	 * @param guildId The guild ID.
	 * @param channelId The channel ID.
	 * @param since Only consider alerts created after this date.
	 *
	 * @returns An object containing the alerts, false positive ratio, and highest score.
	 */
	public static async getRecentAlertsAndFalsePositiveRatio(
		guildId: string,
		channelId: string,
		since: Date
	): Promise<{ alerts: ContentFilterAlert[]; falsePositiveRatio: number; highestScore: number }> {
		const alerts = await prisma.contentFilterAlert.findMany({
			where: {
				guild_id: guildId,
				channel_id: channelId,
				created_at: { gte: since }
			}
		});

		const total = alerts.length;
		const falseCount = alerts.filter(a => a.mod_status === ContentFilterStatus.False).length;
		const ratio = total > 0 ? falseCount / total : 0;
		const highestScore = Math.max(...alerts.map(a => a.highest_score ?? 0), 0);

		return { alerts, falsePositiveRatio: ratio, highestScore };
	}

	/**
	 * Check if an alert already exists for a message.
	 *
	 * @param messageId The ID of the message to check.
	 * @returns True if an alert exists, false otherwise.
	 */
	public static async alertExistsForMessage(messageId: string): Promise<boolean> {
		const existing = await prisma.contentFilterAlert.findFirst({
			where: { message_id: messageId }
		});
		return existing !== null;
	}

	/** Delete old content filter alerts.
	 *
	 * @param ttl Time-to-live in milliseconds. Defaults to CONTENT_FILTER_ALERT_TTL.
	 * @returns The number of deleted alerts.
	 */
	public static async deleteOldAlerts(ttl: number = CONTENT_FILTER_ALERT_TTL): Promise<number> {
		const threshold = new Date(Date.now() - ttl);
		const { count } = await prisma.contentFilterAlert.deleteMany({
			where: {
				created_at: { lt: threshold }
			}
		});

		return count;
	}

	/**
	 * Delete old content filter logs.
	 *
	 * @param ttl Time-to-live in milliseconds. Defaults to CONTENT_FILTER_LOG_TTL.
	 * @returns The number of deleted logs.
	 */
	public static async deleteOldContentLogs(ttl: number = CONTENT_FILTER_LOG_TTL): Promise<number> {
		const threshold = new Date(Date.now() - ttl);
		const { count } = await prisma.contentFilterLog.deleteMany({
			where: {
				created_at: { lt: threshold }
			}
		});

		return count;
	}

	/**
	 * Handle alert moderation status transitions.
	 * Returns the final status based on the original status and target action.
	 *
	 * @param original The current status of the alert.
	 * @param target The desired status to transition to.
	 * @returns The resulting status after applying the transition rules.
	 */
	public static handleAlertModStatus(
		original: ContentFilterStatus,
		target: ContentFilterStatus
	): ContentFilterStatus {
		if (target === ContentFilterStatus.Resolved) {
			switch (original) {
				case ContentFilterStatus.Pending:
				case ContentFilterStatus.False:
					return ContentFilterStatus.Resolved;
				default:
					return ContentFilterStatus.Pending;
			}
		} else if (target === ContentFilterStatus.False) {
			switch (original) {
				case ContentFilterStatus.Pending:
				case ContentFilterStatus.Resolved:
					return ContentFilterStatus.False;
				default:
					return ContentFilterStatus.Pending;
			}
		}

		return original;
	}

	/**
	 * Update an alert's mod_status in the database.
	 *
	 * @param alertId The ID of the alert to update.
	 * @param newStatus The new moderation status to set.
	 * @returns The updated ContentFilterAlert or null if not found.
	 */
	public static async updateAlertModStatus(
		alertId: string,
		newStatus: ContentFilterStatus
	): Promise<ContentFilterAlert | null> {
		return prisma.contentFilterAlert
			.update({
				where: { id: alertId },
				data: { mod_status: newStatus }
			})
			.catch(() => null);
	}

	/**
	 * Update an alert's del_status in the database.
	 *
	 * @param alertId The ID of the alert to update.
	 * @param newStatus The new deletion status to set.
	 * @returns The updated ContentFilterAlert or null if not found.
	 */
	public static async updateAlertDelStatus(
		alertId: string,
		newStatus: ContentFilterStatus
	): Promise<ContentFilterAlert | null> {
		return prisma.contentFilterAlert
			.update({
				where: { id: alertId },
				data: { del_status: newStatus }
			})
			.catch(() => null);
	}

	/**
	 * Get an alert by message ID.
	 *
	 * @param messageId The ID of the message.
	 * @returns The ContentFilterAlert or null if not found.
	 */
	static async getAlertByMessageId(messageId: string): Promise<ContentFilterAlert | null> {
		return prisma.contentFilterAlert.findFirst({
			where: { message_id: messageId }
		});
	}

	/**
	 * Get content log by alert ID.
	 *
	 * @param alertId The ID of the alert.
	 * @returns The content log string or null if not found.
	 */
	static async getContentLogByAlertId(alertId: string): Promise<string | null> {
		const log = await prisma.contentFilterLog.findFirst({
			where: { alert_id: alertId }
		});
		return log?.content ?? null;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HeuristicScanner
// ─────────────────────────────────────────────────────────────────────────────

export class HeuristicScanner {
	/** Heuristic scanning timers. */
	private static _scanTimers: Map<Snowflake, NodeJS.Timeout> = new Map();

	/** Last scan timestamps per channel for debouncing. */
	private static _lastScanTimestamps: Map<Snowflake, number> = new Map();

	/**
	 * Calculate if chat rate has increased significantly.
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns True if chat rate has increased, false otherwise.
	 */
	public static calculateChatRateIncrease(messages: SerializedMessage[]): boolean {
		const recentMessages = this.getRecentMessages(messages);
		const previousMessages = this.getPreviousMessages(messages);

		return recentMessages.length - previousMessages.length >= MESSAGE_PACE_INCREASE_THRESHOLD;
	}

	/**
	 * Get recent messages within the time range.
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns Recent messages within the defined time range.
	 */
	static getRecentMessages(messages: SerializedMessage[]): SerializedMessage[] {
		const now = Date.now();
		return messages.filter(m => m.created_at.getTime() >= now - MESSAGE_QUEUE_TIME_RANGE);
	}

	/**
	 * Get previous messages from the window before the current time range.
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns Previous messages from the defined time range.
	 */
	public static getPreviousMessages(messages: SerializedMessage[]): SerializedMessage[] {
		const now = Date.now();
		return messages.filter(
			m =>
				m.created_at.getTime() >= now - MESSAGE_QUEUE_TIME_RANGE * 2 &&
				m.created_at.getTime() < now - MESSAGE_QUEUE_TIME_RANGE
		);
	}

	/**
	 * Find messages containing reaction patterns (e.g., uppercase text like "WTF", "OMG").
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns Messages that match reaction patterns.
	 */
	public static findReactionMessages(messages: SerializedMessage[]): SerializedMessage[] {
		const reactionMessages: SerializedMessage[] = [];

		for (const m of messages) {
			if (m.content && HEURISTIC_REACTION_REGEX.test(m.content)) {
				reactionMessages.push(m);
			}
		}

		return reactionMessages;
	}

	/**
	 * Find matching/similar messages from different authors using string distance.
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns Messages that are similar to others in the set.
	 */
	public static findMatchingMessages(messages: SerializedMessage[]): SerializedMessage[] {
		const matchingMessages: SerializedMessage[] = [];

		for (let i = 0; i < messages.length - 1; i++) {
			const current = messages[i];
			const next = messages[i + 1];

			if (current.content && next.content && current.author_id !== next.author_id) {
				// Use Levenshtein distance - if distance is less than threshold, consider similar.
				const dist = distance(current.content.toLowerCase(), next.content.toLowerCase());
				const maxLen = Math.max(current.content.length, next.content.length);
				const similarity = 1 - dist / maxLen;

				// Consider messages similar if 80%+ match or distance <= threshold.
				if (similarity >= 0.8 || dist <= MESSAGE_DISTANCE_THRESHOLD) {
					matchingMessages.push(current);
				}
			}
		}

		return matchingMessages;
	}

	/**
	 * Calculate heuristic scores based on reaction messages, matching messages, and chat rate.
	 *
	 * @param reactionMessages Messages identified as reactions.
	 * @param matchingMessages Messages identified as similar/matching.
	 * @param chatRateIncreased Whether the chat rate has increased significantly.
	 */
	public static async calculateHeuristics(
		reactionMessages: SerializedMessage[],
		matchingMessages: SerializedMessage[],
		chatRateIncreased: boolean
	): Promise<HeuristicData> {
		const referenceData: HeuristicMessageData[] = [];

		let standardScore: number = DEFAULT_STANDARD_MESSAGE_SCORE;

		for (const message of [...reactionMessages, ...matchingMessages]) {
			if (message.reference_id) {
				const idx = referenceData.findIndex(reference => reference.message.id === message.reference_id);

				if (idx !== -1) {
					referenceData[idx].score++;
				} else {
					// Fetch reference message from MessageQueue.
					const reference = await MessageQueue.getMessage(message.reference_id);

					if (reference) {
						referenceData.push({ message: reference, score: DEFAULT_REPLY_MESSAGE_SCORE });
					}
				}
			} else {
				standardScore++;
			}
		}

		if (chatRateIncreased) {
			standardScore++;
			referenceData.forEach(reference => reference.score++);
		}

		return { standardScore, referenceData };
	}

	/**
	 * Apply heuristic findings to predictions.
	 *
	 * @param predictions The existing content predictions.
	 * @param reactionMessages Messages identified as reactions.
	 * @param matchingMessages Messages identified as similar/matching.
	 * @param chatRateIncreased Whether the chat rate has increased significantly.
	 * @returns Updated content predictions with heuristic data included.
	 */
	public static applyHeuristicsToPredictions(
		predictions: ContentPredictions[],
		reactionMessages: SerializedMessage[],
		matchingMessages: SerializedMessage[],
		chatRateIncreased: boolean
	): ContentPredictions[] {
		const heuristicPredictions: ContentPredictions = {
			data: [],
			detector: null,
			content: null
		};

		if (reactionMessages.length > 0) {
			heuristicPredictions.data.push({
				content: `⚠️ Detected (${reactionMessages.length}) adverse reactions`
			});
		}

		if (matchingMessages.length > 0) {
			heuristicPredictions.data.push({
				content: `⚠️ Detected (${matchingMessages.length}) similar messages`
			});
		}

		if (chatRateIncreased) {
			heuristicPredictions.data.push({
				content: `⚠️ Detected increased chat rate`
			});
		}

		if (heuristicPredictions.data.length > 0) {
			predictions.push(heuristicPredictions);
		}

		return predictions;
	}

	/**
	 * Trigger a heuristic scan for a single message.
	 * Uses per-channel debouncing to avoid excessive scans.
	 *
	 * @param message The message to scan.
	 * @param config The content filter configuration.
	 * @return void
	 */
	public static async triggerScan(message: Message<true>, config: ContentFilterConfig): Promise<void> {
		if (!config.enabled) return;

		const channel = message.channel as TextChannel;
		const channelId = channel.id;

		// Check channel scoping.
		const scoping = {
			include_channels: config.included_channels ?? [],
			exclude_channels: config.excluded_channels ?? []
		};
		if (!channelInScope(channel, scoping)) return;

		// Access shared channel state from AutomatedScanner.
		const state = AutomatedScanner.getOrInitChannelState(channelId);

		// Use EWMA message-per-minute as chat rate when available.
		const chatRate = Math.max(1, Math.round(state.ewmaMpm ?? HEURISTIC_BASE_SCAN_RATE));

		// Map chatRate [1..20+] to debounce window between configured min/max.
		let debounceMs = Math.floor(
			HEURISTIC_SCAN_DEBOUNCE_MIN +
				(Math.min(chatRate, 20) / 20) * (HEURISTIC_SCAN_DEBOUNCE_MAX - HEURISTIC_SCAN_DEBOUNCE_MIN)
		);
		debounceMs = Math.max(debounceMs, HEURISTIC_SCAN_DEBOUNCE_MIN_DELAY);

		const now = Date.now();
		const lastScan = this._lastScanTimestamps.get(channelId) ?? 0;
		const timeSinceLastScan = now - lastScan;

		// If a timer is already scheduled for this channel, do nothing.
		if (this._scanTimers.has(channelId)) return;

		let delay = debounceMs;

		if (timeSinceLastScan < debounceMs) {
			delay = debounceMs - timeSinceLastScan;
		}

		const timer = setTimeout(async () => {
			// Update last-run timestamp immediately to avoid quick re-schedules.
			this._lastScanTimestamps.set(channelId, Date.now());

			try {
				await this._heuristicScan(channel, config);
			} catch (err) {
				Logger.error("Heuristic scheduled scan failed:", err);
			}

			this._scanTimers.delete(channelId);
		}, delay);

		this._scanTimers.set(channelId, timer);
	}

	/**
	 * Perform a heuristic scan on a channel based on recent message activity and content.
	 */
	private static async _heuristicScan(channel: TextChannel, config: ContentFilterConfig): Promise<void> {
		if (!config.enabled) return;

		const channelId = channel.id;
		const state = AutomatedScanner.getOrInitChannelState(channelId);
		const now = Date.now();

		// Update channel timestamps.
		if (!state.scanTimestamps) state.scanTimestamps = [];
		state.scanTimestamps.push(now);

		// Dynamic window size based on observed traffic.
		const traffic = Math.max(1, Math.round(state.ewmaMpm ?? HEURISTIC_BASE_SCAN_RATE));
		const multiplier = Math.min(
			HEURISTIC_DYNAMIC_WINDOW_MULT_MAX,
			traffic / Math.max(1, HEURISTIC_BASE_SCAN_RATE)
		);
		const dynamicWindow = Math.max(HEURISTIC_DYNAMIC_WINDOW_MIN, Math.round(HEURISTIC_WINDOW_SIZE * multiplier));
		const windowSize = Math.min(dynamicWindow, HEURISTIC_WINDOW_SIZE * HEURISTIC_DYNAMIC_WINDOW_MULT_MAX);

		// Get messages from the queue.
		const serializedMessages = await MessageQueue.getMessagesForChannel(channelId, windowSize);
		if (serializedMessages.length === 0) return;

		const chatRateIncreased = this.calculateChatRateIncrease(serializedMessages);
		const reactionMessages = this.findReactionMessages(serializedMessages);
		const matchingMessages = this.findMatchingMessages(serializedMessages);

		const heur = await this.calculateHeuristics(reactionMessages, matchingMessages, chatRateIncreased);

		const scanRate = state.scanRate ?? HEURISTIC_BASE_SCAN_RATE;
		const trafficForThreshold = Math.max(1, Math.round(state.ewmaMpm ?? HEURISTIC_BASE_SCAN_RATE));
		const ratio = trafficForThreshold / Math.max(1, scanRate);
		const dynamicThreshold = Math.max(1, Math.round(HEURISTIC_SCORE_THRESHOLD * Math.sqrt(ratio)));

		// Collect candidate message IDs for scanning.
		const candidateIds = new Set<Snowflake>();

		if (heur.standardScore >= dynamicThreshold) {
			const candidateCount = Math.max(
				HEURISTIC_MIN_CANDIDATES,
				Math.round(traffic / HEURISTIC_CANDIDATE_TRAFFIC_DIVISOR)
			);
			for (const m of serializedMessages.slice(0, candidateCount)) {
				candidateIds.add(m.id);
			}
		}

		// Only include referenced messages that meet the threshold.
		for (const ref of heur.referenceData) {
			if (ref.score >= dynamicThreshold) {
				candidateIds.add(ref.message.id);
			}
		}

		// Process each candidate message.
		for (const messageId of candidateIds) {
			// Check if alert already exists to avoid duplicates.
			const existing = await ContentFilterUtils.alertExistsForMessage(messageId);
			if (existing) continue;

			// Try to fetch the actual message.
			try {
				const actualMessage = await channel.messages.fetch(messageId).catch(() => null);
				if (!actualMessage || !actualMessage.inGuild()) continue;

				// Run detectors.
				const predictions = await ContentFiltering.runDetectors(channel, actualMessage, config);

				if (predictions.length) {
					// Update predictions with heuristic data.
					const updatedPredictions = this.applyHeuristicsToPredictions(
						predictions,
						reactionMessages,
						matchingMessages,
						chatRateIncreased
					);

					await ContentFiltering.createContentFilterAlert(
						updatedPredictions,
						ScanTypes.Heuristic,
						actualMessage,
						config
					);
				}
			} catch (err) {
				Logger.error("Heuristic per-message scan error:", err);
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// AutomatedScanner
// ─────────────────────────────────────────────────────────────────────────────

export class AutomatedScanner {
	/** Channel scan states. */
	private static _channelScanStates: Map<Snowflake, ChannelScanState> = new Map();

	/** Priority queue for user scans. */
	private static _userPriorityQueue: MinimumHeap = new MinimumHeap();

	/** Tick interval handle. */
	private static _tickInterval: NodeJS.Timeout | null = null;

	/** Smoothed false positive ratios per channel. */
	private static _smoothedFalsePositive: Map<Snowflake, number> = new Map();

	/** Accessors for private static properties. */
	private static pid = {
		integral: 0,
		lastError: 0,
		lastUpdate: Date.now()
	};

	/** Start the tick loop for processing queued scans. */
	public static startTickLoop(): void {
		if (this._tickInterval) return;
		this._tickInterval = setInterval(() => this.tick(), HEURISTIC_TICK_INTERVAL_MS);
	}

	/** Stop the tick loop. */
	public static stopTickLoop(): void {
		if (this._tickInterval) {
			clearInterval(this._tickInterval);
			this._tickInterval = null;
		}
	}

	/**
	 * Get or initialize channel state.
	 *
	 * @param channelId The ID of the channel.
	 * @returns The ChannelScanState for the channel.
	 */
	public static getOrInitChannelState(channelId: Snowflake): ChannelScanState {
		let state = this._channelScanStates.get(channelId);

		if (!state) {
			state = {
				scanTimestamps: [],
				alertCount: 0,
				scanRate: HEURISTIC_BASE_SCAN_RATE,
				ewmaMpm: HEURISTIC_BASE_SCAN_RATE,
				loggedRateEwma: HEURISTIC_BASE_SCAN_RATE,
				messageTimestamps: [],
				betaLastUpdate: Date.now(),
				betaA: 1,
				betaB: 1,
				falsePositiveRatio: 0,
				lastRateLog: 0,
				flaggedUsers: new Map(),
				lastRateIncrease: 0,
				priorityAlertedUsers: new Set(),
				userScores: new Map()
			};

			this._channelScanStates.set(channelId, state);
		}

		if (!state.priorityAlertedUsers) state.priorityAlertedUsers = new Set();
		if (!state.flaggedUsers) state.flaggedUsers = new Map();
		if (!state.userScores) state.userScores = new Map();

		return state;
	}

	/** Enqueue a message for automated scanning.
	 *
	 * @param message The message to enqueue.
	 * @param config The content filter configuration.
	 * @param serializedMessage The serialized message data.
	 */
	public static enqueueForScan(
		message: Message<true>,
		config: ContentFilterConfig,
		serializedMessage: SerializedMessage
	): void {
		if (!config.enabled) return;

		// Channel scoping check
		const scoping: ChannelScoping = {
			include_channels: config.included_channels ?? [],
			exclude_channels: config.excluded_channels ?? []
		};

		if (!channelInScope(message.channel as TextChannel, scoping)) return;

		const now = Date.now();
		const state = this.getOrInitChannelState(message.channel.id);

		if (!state.messageTimestamps) state.messageTimestamps = [];
		state.messageTimestamps.push(now);
		state.messageTimestamps = state.messageTimestamps.filter((ts: number) => now - ts <= HEURISTIC_SCAN_WINDOW);

		const measuredMpm = state.messageTimestamps.length;
		state.ewmaMpm = this._ewma(state.ewmaMpm, measuredMpm, HEURISTIC_EWMA_MPM_ALPHA);

		const risk = ContentFilterUtils.computeMessageRisk(config, serializedMessage);
		const next = this._scheduleNextScan(now, state.scanRate, risk, state.ewmaMpm);

		this._userPriorityQueue.push({
			userId: message.author.id,
			channelId: message.channel.id,
			message,
			risk,
			nextScan: next
		});
	}

	/** Process queued scans during tick. */
	private static async tick(): Promise<void> {
		const now = Date.now();
		const globalRate = Math.min(
			HEURISTIC_MAX_SCAN_RATE,
			Math.max(HEURISTIC_BASE_SCAN_RATE, this._aggregateChannelScanRateEstimate())
		);
		const scansPerSecond = globalRate / 60;
		const tickDuration = HEURISTIC_TICK_INTERVAL_MS;
		const allowedScans = Math.max(1, Math.floor(scansPerSecond * (tickDuration / 1000)));

		let processed = 0;
		while (processed < allowedScans && this._userPriorityQueue.size() > 0) {
			const entry = this._userPriorityQueue.pop();
			if (!entry) break;

			if (entry.nextScan > now) {
				this._userPriorityQueue.push(entry);
				break;
			}

			try {
				const guildConfig = await ConfigManager.getGuildConfig(entry.message.guildId);
				const contentFilterConfig = guildConfig.getContentFilterConfig();

				if (contentFilterConfig) {
					const predictions = await ContentFiltering.runDetectors(
						entry.message.channel,
						entry.message,
						contentFilterConfig
					);

					if (predictions.length > 0) {
						await ContentFiltering.createContentFilterAlert(
							predictions,
							ScanTypes.Automated,
							entry.message,
							contentFilterConfig
						);

						// Update state with predictions.
						const state = this.getOrInitChannelState(entry.channelId);
						const smoothedFP = this._smoothedFalsePositive.get(entry.channelId) ?? 0;
						await this.applyPredictionsToState(
							state,
							entry.userId,
							predictions,
							now,
							entry.risk,
							smoothedFP
						);

						// Adjust scan rate based on results.
						this.adjustScanRate(state, now, smoothedFP);
					}
				}
			} catch (error) {
				Logger.error("Error during automated scan tick:", error);
			}

			processed++;
		}
	}

	/**
	 * Handle moderator feedback to update false positive estimates.
	 *
	 * @param channelId The ID of the channel.
	 * @param wasFalse Whether the alert was marked as false positive.
	 */
	public static async handleModeratorFeedback(channelId: Snowflake, wasFalse: boolean): Promise<void> {
		const state = this.getOrInitChannelState(channelId);

		const prevA = state.betaA ?? 1;
		const prevB = state.betaB ?? 1;
		const incA = wasFalse ? 1 : 0;
		const incB = wasFalse ? 0 : 1;

		const targetA = prevA + Math.min(HEURISTIC_MAX_BETA_INCREMENT_PER_CALL, incA);
		const targetB = prevB + Math.min(HEURISTIC_MAX_BETA_INCREMENT_PER_CALL, incB);

		state.betaA = Math.max(1, prevA * (1 - HEURISTIC_SMOOTHED_FP_ALPHA) + targetA * HEURISTIC_SMOOTHED_FP_ALPHA);
		state.betaB = Math.max(1, prevB * (1 - HEURISTIC_SMOOTHED_FP_ALPHA) + targetB * HEURISTIC_SMOOTHED_FP_ALPHA);

		const mean = this._betaMean(state);

		this._smoothedFalsePositive.set(
			channelId,
			(this._smoothedFalsePositive.get(channelId) ?? 0) * (1 - HEURISTIC_SMOOTHED_FP_ALPHA) +
				mean * HEURISTIC_SMOOTHED_FP_ALPHA
		);
	}

	/**
	 * Perform a full automated scan on a message.
	 * Includes duplicate detection, priority user handling, and state updates.
	 *
	 * @param channel The text channel of the message.
	 * @param message The message to scan.
	 * @param config The content filter configuration.
	 */
	public static async automatedScan(
		channel: TextChannel,
		message: Message<true>,
		config: ContentFilterConfig
	): Promise<void> {
		if (!config.enabled) return;

		// Channel scoping check.
		const scoping = {
			include_channels: config.included_channels ?? [],
			exclude_channels: config.excluded_channels ?? []
		};

		if (!channelInScope(channel, scoping)) return;

		const now = Date.now();

		// Check if an alert already exists for this message.
		const existing = await ContentFilterUtils.alertExistsForMessage(message.id);
		if (existing) return;

		// Prepare channel state.
		const prep = await this.prepareChannelForScan(channel, message, config, now);
		if (!prep || !prep.shouldScan) return;

		const { state, smoothed, riskScore } = prep;

		// Run detectors.
		const predictions = await ContentFiltering.runDetectors(channel, message, config);

		if (predictions.length > 0) {
			// Update state with predictions.
			await this.applyPredictionsToState(state, message.author.id, predictions, now, riskScore, smoothed);

			// Create alert.
			await ContentFiltering.createContentFilterAlert(predictions, ScanTypes.Automated, message, config);

			// Adjust scan rate based on results
			const shouldLog = this.adjustScanRate(state, now, smoothed);

			// Log scan rate changes if verbose
			if (shouldLog && config.verbosity === "Verbose") {
				await this.sendScanRateChangeLog(channel, state.scanRate, config);
			}
		}
	}

	/**
	 * Prepare a channel state for scanning and decide whether to run a scan for the given message.
	 *
	 * @param channel The text channel of the message.
	 * @param message The message to scan.
	 * @param config The content filter configuration.
	 * @param now The current timestamp in milliseconds.
	 * @param options Optional parameters including risk score and force scan flag.
	 * @returns An object containing the channel state, whether to scan, smoothed false positive ratio, and risk score; or null if scanning is disabled.
	 */
	public static async prepareChannelForScan(
		channel: TextChannel,
		message: Message<true>,
		config: ContentFilterConfig,
		now: number,
		options?: { risk?: number; force?: boolean }
	): Promise<{
		state: ChannelScanState;
		shouldScan: boolean;
		smoothed: number;
		riskScore: number;
	} | null> {
		if (!config.enabled) return null;

		const channelId = channel.id;
		const state = this.getOrInitChannelState(channelId);
		this.cleanupOldTimestamps(state, now, CONTENT_FILTER_ALERT_TTL);

		if (!state.userScores) state.userScores = new Map();
		if (!state.priorityAlertedUsers) state.priorityAlertedUsers = new Set();

		let effectiveRisk = options?.risk;
		let trafficEstimate = HEURISTIC_DEFAULT_TRAFFIC_ESTIMATE;
		let falsePositiveRatio = 0;

		try {
			const traffic = Math.max(1, Math.round(state.ewmaMpm ?? HEURISTIC_BASE_SCAN_RATE));
			const windowMs = Math.max(
				HEURISTIC_WINDOW_MIN_MS,
				Math.min(
					HEURISTIC_WINDOW_MAX_MS,
					Math.round(HEURISTIC_WINDOW_BASE_MS * (HEURISTIC_BASE_SCAN_RATE / traffic))
				)
			);
			const windowStart = new Date(now - windowMs);

			const { falsePositiveRatio: ratio, highestScore } =
				await ContentFilterUtils.getRecentAlertsAndFalsePositiveRatio(
					channel.guildId,
					channelId,
					windowStart
				);

			falsePositiveRatio = ratio;
			trafficEstimate = Math.max(1, Math.round(state.ewmaMpm ?? HEURISTIC_BASE_SCAN_RATE));

			if (highestScore && effectiveRisk === undefined) {
				effectiveRisk = Math.min(1, highestScore / 10);
			}
		} catch {
			// Ignore errors and use defaults.
		}

		const prevSmoothed = this._smoothedFalsePositive.get(channelId) ?? 0;
		const smoothed =
			prevSmoothed * (1 - HEURISTIC_SMOOTHED_FP_ALPHA) + falsePositiveRatio * HEURISTIC_SMOOTHED_FP_ALPHA;
		this._smoothedFalsePositive.set(channelId, smoothed);

		const decayFinal = this._computeDecayFactor(state, smoothed);
		const priorityThresholdFinal = this.computePriorityThreshold(state, smoothed);

		// Read the user entry from userScores.
		const existingEntry = state.userScores.get(message.author.id) ?? { score: 0, lastScan: 0 };
		let userScore = existingEntry.score;

		// Decay user score if > 0.
		if (userScore > 0) {
			userScore = userScore * decayFinal;
			existingEntry.score = userScore;
			state.userScores.set(message.author.id, existingEntry);
		}

		const isPriorityUser = userScore >= priorityThresholdFinal;
		const riskScore = effectiveRisk ?? 0.5;
		let shouldScan = !!options?.force;

		if (!shouldScan) {
			if (isPriorityUser) {
				shouldScan = true;
			} else {
				const baseScanRate = this.getDynamicBaseScanRateForState(state);
				const samplingFactor = Math.min(1, Math.max(HEURISTIC_MIN_SAMPLING_FACTOR, riskScore));
				const probability = Math.min(1, (baseScanRate / Math.max(trafficEstimate, 1)) * samplingFactor);
				shouldScan = Math.random() < probability;
			}
		}

		if (!shouldScan && !options?.force) {
			return { state, shouldScan, smoothed, riskScore };
		}

		// Mark last scan time for this user.
		const entryToSet = state.userScores.get(message.author.id) ?? { score: 0, lastScan: 0 };
		entryToSet.lastScan = now;
		state.userScores.set(message.author.id, entryToSet);
		state.scanTimestamps.push(now);

		// Priority user alert.
		if (isPriorityUser && config.verbosity !== "Minimal") {
			if (!state.priorityAlertedUsers.has(message.author.id)) {
				await this.sendPriorityUserWarning(message, config);
				state.priorityAlertedUsers.add(message.author.id);
			}
		} else if (!isPriorityUser && state.priorityAlertedUsers.has(message.author.id)) {
			state.priorityAlertedUsers.delete(message.author.id);
		}

		return { state, shouldScan, smoothed, riskScore };
	}

	/** Send a priority user warning to the configured webhook.
	 *
	 * @param message The message from the priority user.
	 * @param config The content filter configuration.
	 */
	public static async sendPriorityUserWarning(message: Message<true>, config: ContentFilterConfig): Promise<any> {
		if (!config.webhook_url) return;

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle(`⚠️ ${ScanTypes.Heuristic}: Priority User Alert`)
			.setDescription(`User ${userMentionWithId(message.author.id)} has been prioritized for scanning.`)
			.setTimestamp();

		const webhook = new WebhookClient({ url: config.webhook_url });
		return webhook.send({ embeds: [embed] }).catch(() => {});
	}

	/**
	 * Send a scan rate change log to the configured webhook.
	 *
	 * @param channel The text channel where the scan rate changed.
	 * @param newRate The new scan rate in messages per minute.
	 * @param config The content filter configuration.
	 */
	public static async sendScanRateChangeLog(
		channel: TextChannel,
		newRate: number,
		config: ContentFilterConfig
	): Promise<any> {
		if (!config.webhook_url) return;

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setTitle(`⚙️ ${ScanTypes.Heuristic}: Scan Rate Change`)
			.setDescription(
				`Scan rate for <#${channel.id}> is now \`${newRate}\` message${newRate === 1 ? "" : "s"} per minute.`
			)
			.setTimestamp();

		const webhook = new WebhookClient({ url: config.webhook_url });
		return webhook.send({ embeds: [embed] }).catch(() => {});
	}

	/**
	 * Compute dynamic base scan rate from channel EWMA and beta mean.
	 *
	 * @param state The channel scan state.
	 * @returns The computed dynamic base scan rate.
	 */
	public static getDynamicBaseScanRateForState(state: ChannelScanState): number {
		const ewmaMpm = state.ewmaMpm ?? HEURISTIC_BASE_SCAN_RATE;
		const beta = this._betaMean(state);

		const raw = Math.round(
			HEURISTIC_K_TRAFFIC * ewmaMpm + HEURISTIC_K_CONF * (1 - beta) * HEURISTIC_BASE_SCAN_RATE
		);

		return Math.max(1, Math.min(HEURISTIC_MAX_SCAN_RATE, raw || HEURISTIC_BASE_SCAN_RATE));
	}

	/**
	 * Compute a dynamic weight to add to a user's score after a detection.
	 *
	 * @param detectorWeight The base weight of the detector.
	 * @param severity The severity of the detection (0 to 1).
	 * @param riskScore The risk score of the message (0 to 1).
	 * @returns The computed dynamic weight.
	 */
	public static computeDynamicWeight(detectorWeight: number, severity: number, riskScore: number): number {
		const w =
			detectorWeight *
			(HEURISTIC_DYNAMIC_WEIGHT_BASE + severity * HEURISTIC_DYNAMIC_WEIGHT_SEVERITY_MULT) *
			(1 + Math.min(1, riskScore));

		return Math.max(HEURISTIC_DYNAMIC_WEIGHT_MIN, Math.min(HEURISTIC_DYNAMIC_WEIGHT_MAX, w));
	}

	/**
	 * Centralized helper to apply prediction results to channel state.
	 *
	 * @param state The channel scan state.
	 * @param authorId The ID of the message author.
	 * @param predictions The content predictions from detectors.
	 * @param now The current timestamp in milliseconds.
	 * @param riskScore The risk score of the message (0 to 1).
	 * @param smoothedFalsePositive The smoothed false positive ratio for the channel.
	 * @returns void
	 */
	public static async applyPredictionsToState(
		state: ChannelScanState,
		authorId: Snowflake,
		predictions: ContentPredictions[],
		now: number,
		riskScore: number,
		smoothedFalsePositive = 0
	): Promise<void> {
		if (!state.flaggedUsers) state.flaggedUsers = new Map();
		if (!state.userScores) state.userScores = new Map();

		state.alertCount = (state.alertCount || 0) + 1;

		const updatedTimestamps = (state.flaggedUsers.get(authorId) || []).filter(
			(ts: number) => now - ts < HEURISTIC_SCAN_WINDOW
		);

		updatedTimestamps.push(now);
		state.flaggedUsers.set(authorId, updatedTimestamps);

		const decayFinal = this._computeDecayFactor(state, smoothedFalsePositive);
		const existingEntry = state.userScores.get(authorId) ?? { score: 0, lastScan: 0 };
		const prevScore = existingEntry.score ?? 0;
		const detectorWeight = Math.min(3, 1 + predictions.length);
		const severity = Math.min(1, (predictions.flatMap(p => p.data).length || 1) / 3);
		const dynamicWeight = this.computeDynamicWeight(detectorWeight, severity, riskScore);
		const newScore = prevScore * decayFinal + dynamicWeight;

		existingEntry.score = newScore;
		state.userScores.set(authorId, existingEntry);
		state.falsePositiveRatio = smoothedFalsePositive;
	}

	/**
	 * PID controller for scan rate adjustment.
	 *
	 * @param state The channel scan state.
	 * @param now The current timestamp in milliseconds.
	 * @param smoothedFalsePositive The smoothed false positive ratio for the channel.
	 * @returns Whether the scan rate change should be logged.
	 */
	public static adjustScanRate(state: ChannelScanState, now: number, smoothedFalsePositive = 0): boolean {
		// Decay beta priors toward uninformative prior over time.
		try {
			const last = state.betaLastUpdate ?? now;
			const dt = Math.max(0, now - last);

			if (dt > 0) {
				const decayFactor = Math.exp(-Math.LN2 * (dt / Math.max(1, HEURISTIC_BETA_DECAY_HALF_LIFE_MS)));
				state.betaA = Math.max(1, (state.betaA ?? 1) * decayFactor);
				state.betaB = Math.max(1, (state.betaB ?? 1) * decayFactor);
				state.betaLastUpdate = now;
			}
		} catch {
			// Ignore decay errors.
		}

		const beta = this._betaMean(state);
		const ewmaMpm = Math.max(1, Math.round(state.ewmaMpm ?? HEURISTIC_BASE_SCAN_RATE));

		const trafficScale = 1 + Math.min(2, Math.log10(1 + ewmaMpm) * 0.25);
		let Kp = HEURISTIC_PID_BASE_KP * (1 + (1 - Math.min(1, beta)) * 0.4) * trafficScale;
		Kp = Math.max(HEURISTIC_PID_KP_MIN, Math.min(HEURISTIC_PID_KP_MAX, Kp));

		let Ki = HEURISTIC_PID_BASE_KI / Math.max(1, Math.log10(1 + ewmaMpm) * 0.5);
		Ki = Math.max(HEURISTIC_PID_KI_MIN, Math.min(HEURISTIC_PID_KI_MAX, Ki));

		let Kd = HEURISTIC_PID_BASE_KD * (1 + Math.min(1, Math.log10(1 + ewmaMpm) * 0.1));
		Kd = Math.max(HEURISTIC_PID_KD_MIN, Math.min(HEURISTIC_PID_KD_MAX, Kd));

		const maxStep = Math.max(
			1,
			Math.round(HEURISTIC_RATE_INCREASE_STEP * (1 + (1 - Math.min(1, smoothedFalsePositive))))
		);

		const baseRate = this.getDynamicBaseScanRateForState(state);
		const minRate = Math.max(HEURISTIC_MIN_SCAN_RATE, baseRate);

		const adaptiveThreshold = this._estimateAdaptiveThreshold(state.scanTimestamps ?? [], now);

		const error = state.alertCount - adaptiveThreshold;
		const nowMs = now;
		const dt = Math.max(1, (nowMs - this.pid.lastUpdate) / 1000);

		this.pid.integral += error * dt;
		const derivative = (error - this.pid.lastError) / dt;
		const output = Kp * error + Ki * this.pid.integral + Kd * derivative;

		let step = Math.max(-maxStep, Math.min(maxStep, Math.round(output)));
		if (step === 0 && error !== 0) step = error > 0 ? 1 : -1;

		const oldRate = state.scanRate;
		state.scanRate = Math.max(minRate, Math.min(HEURISTIC_MAX_SCAN_RATE, state.scanRate + step));

		if (state.scanRate > oldRate) {
			state.lastRateIncrease = now;
		}

		let changed = false;
		if (state.scanRate !== oldRate) {
			state.alertCount = 0;
			changed = true;
		}

		this.pid.lastError = error;
		this.pid.lastUpdate = nowMs;

		if (state.scanRate > baseRate && now - state.lastRateIncrease > HEURISTIC_RATE_INCREASE_DURATION) {
			state.scanRate = Math.max(
				baseRate,
				Math.round(state.scanRate * HEURISTIC_RATE_DECAY_A + baseRate * HEURISTIC_RATE_DECAY_B)
			);
			state.lastRateIncrease = now;
			state.alertCount = 0;
			changed = true;
		}

		const newRate = state.scanRate;
		const loggedEwmaPrev = state.loggedRateEwma ?? oldRate;
		const absChangeFromLogged = Math.abs(newRate - loggedEwmaPrev);
		const significantChange = absChangeFromLogged >= HEURISTIC_MIN_ABS_CHANGE_FOR_LOG;
		const lastLog = state.lastRateLog ?? 0;

		let shouldLog = false;
		if (changed && significantChange) {
			if (!lastLog) {
				state.lastRateLog = now;
				shouldLog = false;
			} else if (now - lastLog > HEURISTIC_RATE_CHANGE_INTERVAL) {
				shouldLog = true;
				state.lastRateLog = now;
			}
		}

		state.loggedRateEwma = Math.round(
			loggedEwmaPrev * (1 - HEURISTIC_LOGGING_SMOOTH_ALPHA) + newRate * HEURISTIC_LOGGING_SMOOTH_ALPHA
		);

		return shouldLog;
	}

	/**
	 * Cleanup old timestamps and user scores.
	 *
	 * @param state The channel scan state.
	 * @param now The current timestamp in milliseconds.
	 * @param ttl The time-to-live for user scores in milliseconds.
	 */
	public static cleanupOldTimestamps(state: ChannelScanState, now: number, ttl: number): void {
		state.scanTimestamps = state.scanTimestamps.filter((ts: number) => now - ts < HEURISTIC_SCAN_WINDOW);

		if (state.flaggedUsers) {
			for (const [userId, timestamps] of state.flaggedUsers.entries()) {
				const pruned = timestamps.filter((ts: number) => now - ts < HEURISTIC_SCAN_WINDOW);

				if (pruned.length > 0) {
					state.flaggedUsers.set(userId, pruned);
				} else {
					state.flaggedUsers.delete(userId);
				}
			}
		}

		if (state.userScores) {
			for (const [userId, entry] of state.userScores.entries()) {
				const lastScan = entry?.lastScan ?? 0;

				if ((entry.score ?? 0) <= HEURISTIC_SCORE_PRUNE_EPSILON && now - lastScan > HEURISTIC_SCAN_WINDOW) {
					state.userScores.delete(userId);
				}
			}

			for (const [userId, entry] of state.userScores.entries()) {
				const lastScan = entry?.lastScan ?? 0;

				if (now - lastScan > ttl) {
					state.userScores.delete(userId);
				}
			}

			if (state.userScores.size > HEURISTIC_USER_SCORES_MAX_SIZE) {
				const candidates: Array<[Snowflake, number]> = Array.from(state.userScores.entries()).map(
					([uid, entry]) => [uid, entry?.lastScan ?? 0]
				);
				candidates.sort((a, b) => a[1] - b[1]);

				const target = Math.floor(HEURISTIC_USER_SCORES_MAX_SIZE * 0.9);

				let idx = 0;
				while (state.userScores.size > target && idx < candidates.length) {
					const userId = candidates[idx][0];
					state.userScores.delete(userId);
					idx++;
				}
			}
		}
	}

	private static _scheduleNextScan(now: number, scanRate: number, risk: number, observedTraffic?: number): number {
		const effective = Math.min(scanRate, observedTraffic ?? scanRate);
		const msgsPerMinute = Math.max(HEURISTIC_MIN_SCAN_RATE, Math.round(effective));
		const baseInterval = HEURISTIC_SCAN_WINDOW / msgsPerMinute;

		const riskClamped = Math.max(0, Math.min(1, risk));
		const multiplier =
			HEURISTIC_RISK_MULTIPLIER_MIN +
			(1 - riskClamped) * (HEURISTIC_RISK_MULTIPLIER_MAX - HEURISTIC_RISK_MULTIPLIER_MIN);

		const jitterMax = Math.min(1000, Math.floor(baseInterval * HEURISTIC_JITTER_PCT));
		const jitter = Math.floor(Math.random() * Math.max(0, jitterMax));

		return now + Math.max(HEURISTIC_MIN_SCHEDULE_DELAY, Math.floor(baseInterval * multiplier)) + jitter;
	}

	private static _ewma(prev: number | undefined, value: number, alpha = HEURISTIC_EWMA_ALPHA): number {
		if (prev === undefined || prev === null) return value;
		return prev * (1 - alpha) + value * alpha;
	}

	private static _betaMean(state: ChannelScanState): number {
		const a = state.betaA ?? 1;
		const b = state.betaB ?? 1;
		const mean = a / (a + b);
		return Math.max(HEURISTIC_BETA_MEAN_MIN, Math.min(HEURISTIC_BETA_MEAN_MAX, mean));
	}

	private static _aggregateChannelScanRateEstimate(): number {
		if (this._channelScanStates.size === 0) return HEURISTIC_BASE_SCAN_RATE;

		let total = 0;
		let count = 0;

		for (const [, s] of this._channelScanStates.entries()) {
			total += this.getDynamicBaseScanRateForState(s) ?? HEURISTIC_BASE_SCAN_RATE;
			count++;
		}

		return Math.max(HEURISTIC_BASE_SCAN_RATE, Math.round(total / Math.max(1, count)));
	}

	private static _computeDecayFactor(state: ChannelScanState, smoothedFalsePositive: number): number {
		const base = HEURISTIC_DECAY_BASE;
		const fpInfluence = Math.min(
			HEURISTIC_DECAY_FP_INFLUENCE_MAX,
			smoothedFalsePositive * HEURISTIC_DECAY_FP_INFLUENCE_FACTOR
		);

		const alertInfluence = Math.min(
			HEURISTIC_DECAY_ALERT_INFLUENCE_MAX,
			(state.alertCount || 0) * HEURISTIC_DECAY_ALERT_INFLUENCE_PER_ALERT
		);

		return Math.max(HEURISTIC_DECAY_MIN, Math.min(HEURISTIC_DECAY_MAX, base - fpInfluence - alertInfluence));
	}

	/**
	 * Compute a dynamic priority threshold (how many score units to become a priority user).
	 *
	 * @param state The channel scan state.
	 * @param smoothedFalsePositive The smoothed false positive ratio for the channel.
	 * @returns The computed priority threshold.
	 */
	public static computePriorityThreshold(state: ChannelScanState, smoothedFalsePositive: number): number {
		const base = HEURISTIC_PRIORITY_USER_FLAG_THRESHOLD || 2;
		const multiplier =
			1 + Math.min(HEURISTIC_PRIORITY_MULT_MAX, smoothedFalsePositive * HEURISTIC_PRIORITY_MULT_FACTOR);
		const recentAlerts = state.scanTimestamps ? state.scanTimestamps.length : 0;
		const recentInfluence = Math.max(0, 1 - Math.min(0.5, recentAlerts / HEURISTIC_RECENT_ALERTS_CAP));

		return Math.max(1, Math.ceil(base * multiplier * recentInfluence));
	}

	private static _estimateAdaptiveThreshold(timestamps: number[], now: number): number {
		if (!timestamps || timestamps.length === 0) return 1;

		const alpha = Math.max(0, Math.min(1, HEURISTIC_ADAPTIVE_DECAY_ALPHA));
		const hist = new Map<number, number>();
		let totalWeight = 0;

		for (let i = 0; i < HEURISTIC_ADAPTIVE_P95_WINDOWS; i++) {
			const start = now - (i + 1) * HEURISTIC_SCAN_WINDOW;
			const end = now - i * HEURISTIC_SCAN_WINDOW;
			const count = timestamps.filter(t => t > start && t <= end).length;
			const weight = Math.pow(alpha, i);
			hist.set(count, (hist.get(count) || 0) + weight);
			totalWeight += weight;
		}

		const entries = Array.from(hist.entries()).sort((a, b) => a[0] - b[0]);
		const target = totalWeight * 0.95;

		let cumsum = 0;
		let p95 = 0;

		for (const [count, w] of entries) {
			cumsum += w;
			p95 = count;
			if (cumsum >= target) break;
		}

		return Math.max(1, Math.ceil(p95 + 1));
	}
}

export default class ContentFiltering {
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
	public static async createContentFilterAlert(
		predictions: ContentPredictions[],
		scanType: ScanTypes,
		message: Message<true>,
		config: ContentFilterConfig
	): Promise<void> {
		if (!config.webhook_url) return;

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
			const detectorLabel = prediction.detector ? `[${prediction.detector}]` : "[HEURISTIC]";
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
			config.notify_roles.length > 0 ? config.notify_roles.map(r => roleMention(r)).join(", ") : undefined;

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

		const alert = await prisma.contentFilterAlert.create({
			data: {
				guild_id: message.guildId,
				message_id: message.id,
				channel_id: message.channelId,
				alert_message_id: alertMessageId,
				alert_channel_id: alertChannelId,
				offender_id: message.author.id,
				detectors: detectorsUsed,
				highest_score: highestScore,
				mod_status: ContentFilterStatus.Pending,
				del_status: ContentFilterStatus.Pending
			}
		});

		// Store flagged content for viewing later.
		if (problematicContent.length > 0) {
			const contentStr = problematicContent.join("\n---\n");
			await prisma.contentFilterLog.create({
				data: {
					guild_id: message.guildId,
					alert_id: alert.id,
					content: contentStr
				}
			});
		}

		// Update channel state for tracking
		const state = AutomatedScanner.getOrInitChannelState(message.channelId);
		state.alertCount++;
		state.scanTimestamps.push(Date.now());
	}

	/**
	 * Scan a message using the specified detector.
	 *
	 * @param message The message to scan.
	 * @param detector The detector to use (NSFW, OCR, TEXT).
	 * @param config The content filter configuration.
	 * @returns The content predictions or null if no issues found.
	 */
	public static async scanMessage(
		message: Message<true>,
		detector: Detector,
		config: ContentFilterConfig
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
				const results = await this.openAiScan(multiModalInput, config, message);
				predictionData.push(...results);

				if (results.length > 0) {
					problematicContent.push("[Media content flagged]");
				}

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

		return predictionData.length ? { data: predictionData, detector, content: problematicContent } : null;
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
		config: ContentFilterConfig
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
	public static async openAiScan(
		content: ModerationMultiModalInput[] | string,
		config: ContentFilterConfig,
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
				this.openAiRateLimitedUntil = Date.now() + DEFAULT_FINAL_DELAY;
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
	public static parseOpenAiModerationResults(results: Moderation[], minScore: number): ContentPredictionData[] {
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
	public static async runDetectors(
		_channel: TextBasedChannel,
		message: Message<true>,
		config: ContentFilterConfig
	): Promise<ContentPredictions[]> {
		const predictions: ContentPredictions[] = [];

		// Check if the author is a bot
		if (message.author.bot) return predictions;

		// Check if the author has immune roles
		if (config.immune_roles && config.immune_roles.length > 0) {
			try {
				const member = await message.guild.members.fetch(message.author.id).catch(() => null);
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

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const HEURISTIC_WINDOW_SIZE = 30;
export const MESSAGE_QUEUE_TIME_RANGE = 5000;
export const MESSAGE_DISTANCE_THRESHOLD = 3;
export const MESSAGE_PACE_INCREASE_THRESHOLD = 5;

export const HEURISTIC_MEDIUM_SCORE = 0.7;
export const HEURISTIC_LENIENT_SCORE = 0.8;

export const HEURISTIC_BASE_RISK = 0.05;
export const HEURISTIC_LENIENT_RISK_INCREASE = 0.3;
export const HEURISTIC_MEDIUM_RISK_INCREASE = 0.4;
export const HEURISTIC_STRICT_RISK_INCREASE = 0.5;

export const HEURISTIC_BASE_SCAN_RATE = 10;
export const HEURISTIC_MAX_SCAN_RATE = 60;
export const HEURISTIC_MIN_SCAN_RATE = 1;
export const HEURISTIC_SCAN_WINDOW = 60 * 1000;

export const HEURISTIC_RATE_INCREASE_STEP = 10;
export const HEURISTIC_RATE_INCREASE_DURATION = 5 * 60 * 1000;
export const HEURISTIC_RATE_CHANGE_INTERVAL = 10 * 60 * 1000;

export const HEURISTIC_SCORE_THRESHOLD = 5;
export const HEURISTIC_DEFAULT_TRAFFIC_ESTIMATE = 60;
export const HEURISTIC_SMOOTHED_FP_ALPHA = 0.1;
export const HEURISTIC_MIN_SAMPLING_FACTOR = 0.01;
export const HEURISTIC_LOGGING_SMOOTH_ALPHA = 0.25;

export const HEURISTIC_MAX_BETA_INCREMENT_PER_CALL = 5;
export const HEURISTIC_BETA_MEAN_MIN = 0.01;
export const HEURISTIC_BETA_MEAN_MAX = 0.99;
export const HEURISTIC_BETA_DECAY_HALF_LIFE_MS = 3 * 60 * 60 * 1000;

export const HEURISTIC_SCORE_FP_INFLUENCE = 0.15;
export const HEURISTIC_USER_RECENT_ALERT_WINDOW_MS = 5 * 60 * 1000;
export const HEURISTIC_SCORE_USER_ALERT_INFLUENCE = 0.12;
export const HEURISTIC_SCORE_PRUNE_EPSILON = 0.1;

export const HEURISTIC_PRIORITY_USER_FLAG_THRESHOLD = 2;

export const HEURISTIC_EWMA_MPM_ALPHA = 0.15;
export const HEURISTIC_EWMA_ALPHA = 0.2;

export const HEURISTIC_PID_BASE_KP = 2.0;
export const HEURISTIC_PID_BASE_KI = 0.08;
export const HEURISTIC_PID_BASE_KD = 0.8;
export const HEURISTIC_PID_KP_MIN = 0.5;
export const HEURISTIC_PID_KP_MAX = 10;
export const HEURISTIC_PID_KI_MIN = 0.001;
export const HEURISTIC_PID_KI_MAX = 1;
export const HEURISTIC_PID_KD_MIN = 0.01;
export const HEURISTIC_PID_KD_MAX = 5;

export const HEURISTIC_K_TRAFFIC = 0.6;
export const HEURISTIC_K_CONF = 0.4;

export const HEURISTIC_DECAY_BASE = 0.92;
export const HEURISTIC_DECAY_FP_INFLUENCE_FACTOR = 0.5;
export const HEURISTIC_DECAY_FP_INFLUENCE_MAX = 0.35;
export const HEURISTIC_DECAY_ALERT_INFLUENCE_PER_ALERT = 0.02;
export const HEURISTIC_DECAY_ALERT_INFLUENCE_MAX = 0.2;
export const HEURISTIC_DECAY_MIN = 0.55;
export const HEURISTIC_DECAY_MAX = 0.98;

export const HEURISTIC_PRIORITY_MULT_FACTOR = 3;
export const HEURISTIC_PRIORITY_MULT_MAX = 2;
export const HEURISTIC_RECENT_ALERTS_CAP = 50;

export const HEURISTIC_DYNAMIC_WEIGHT_BASE = 0.6;
export const HEURISTIC_DYNAMIC_WEIGHT_SEVERITY_MULT = 1.2;
export const HEURISTIC_DYNAMIC_WEIGHT_MIN = 0.5;
export const HEURISTIC_DYNAMIC_WEIGHT_MAX = 5;

export const HEURISTIC_RISK_MULTIPLIER_MIN = 0.2;
export const HEURISTIC_RISK_MULTIPLIER_MAX = 1.0;
export const HEURISTIC_JITTER_PCT = 0.1;
export const HEURISTIC_MIN_SCHEDULE_DELAY = 100;

export const HEURISTIC_WINDOW_BASE_MS = 120_000;
export const HEURISTIC_WINDOW_MIN_MS = 30_000;
export const HEURISTIC_WINDOW_MAX_MS = 300_000;

export const HEURISTIC_ADAPTIVE_P95_WINDOWS = 10;
export const HEURISTIC_ADAPTIVE_DECAY_ALPHA = 0.6;
export const HEURISTIC_TICK_INTERVAL_MS = 100;

export const HEURISTIC_DYNAMIC_WINDOW_MULT_MAX = 4;
export const HEURISTIC_DYNAMIC_WINDOW_MIN = 10;

export const HEURISTIC_MIN_CANDIDATES = 5;
export const HEURISTIC_CANDIDATE_TRAFFIC_DIVISOR = 10;

export const HEURISTIC_RATE_DECAY_A = 0.6;
export const HEURISTIC_RATE_DECAY_B = 0.4;
export const HEURISTIC_MIN_ABS_CHANGE_FOR_LOG = 10;

export const HEURISTIC_SCAN_DEBOUNCE_MIN = 10_000;
export const HEURISTIC_SCAN_DEBOUNCE_MAX = 60_000;
export const HEURISTIC_SCAN_DEBOUNCE_MIN_DELAY = 10_000;

export const HEURISTIC_USER_SCORES_MAX_SIZE = 1000;

export const HEURISTIC_REACTION_REGEX: Readonly<RegExp> = /\p{Lu}{3,11}/u;
export const DEFAULT_STANDARD_MESSAGE_SCORE = 1;
export const DEFAULT_REPLY_MESSAGE_SCORE = 1;

export const DEFAULT_INITIAL_DELAY = 2.5 * 60 * 1000;
export const DEFAULT_RETRY_JITTER = 0.3;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BACKOFF_FACTOR = 2;
export const DEFAULT_MAX_DELAY = 5 * 60 * 1000;
export const DEFAULT_FINAL_DELAY = 10 * 60 * 1000;

// TTL for content filter alerts and logs (24 hours default)
export const CONTENT_FILTER_ALERT_TTL = 24 * 60 * 60 * 1000;
export const CONTENT_FILTER_LOG_TTL = 7 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface HeuristicMessageData {
	message: SerializedMessage;
	score: number;
}

export interface HeuristicData {
	standardScore: number;
	referenceData: HeuristicMessageData[];
}

export interface ContentPredictionData {
	content: string;
	score?: string;
}

export interface ContentPredictions {
	data: ContentPredictionData[];
	detector: Detector | null;
	content: string[] | null;
}

export enum ContentFilterFieldNames {
	ContentFound = "Content found",
	MessageLink = "Link to message",
	Offender = "Offender",
	ResponseTime = "Response time",
	DelStatus = "Deletion status",
	ModStatus = "Moderation status",
	ScanStatus = "Scan status",
	ScanResults = "Scan results"
}

export enum ContentFilterButtonNames {
	Content = "View content",
	DelMessage = "Delete message",
	False = "False positive",
	Resolve = "Resolve"
}

export enum ScanTypes {
	Automated = "AUTOMATED SCAN",
	Heuristic = "HEURISTIC SCAN"
}

export interface ChannelScanState {
	scanTimestamps: number[];
	alertCount: number;
	scanRate: number;
	falsePositiveRatio?: number;
	lastRateLog?: number;
	ewmaMpm?: number;
	loggedRateEwma?: number;
	messageTimestamps?: number[];
	betaLastUpdate?: number;
	betaA?: number;
	betaB?: number;
	flaggedUsers: Map<Snowflake, number[]>;
	lastRateIncrease: number;
	priorityAlertedUsers: Set<Snowflake>;
	userScores: Map<Snowflake, { score: number; lastScan: number }>;
}
