import { distance } from "closest-match";
import type { Snowflake, TextChannel, Message as DiscordMessage } from "discord.js";

import { ScanTypes } from "./Enums.js";
import { CF_CONSTANTS } from "#utils/Constants.js";
import { channelInScope, parseChannelScoping } from "#utils/index.js";

import type { Message } from "#kysely/Schema.js";
import type { ValidatedContentFilterConfig } from "#config/GuildConfig.js";
import type { ContentPredictions, HeuristicData, HeuristicMessageData } from "./Types.js";

import Logger from "#utils/Logger.js";
import Messages from "#utils/Messages.js";
import ContentFilter from "./ContentFilter.js";
import AutomatedScanner from "./AutomatedScanner.js";
import ContentFilterUtils from "#utils/ContentFilter.js";

/** Maximum number of channels to track timers for. */
const MAX_TIMER_CHANNELS = 100;

/** Time after which a timestamp entry is considered stale (10 minutes). */
const TIMESTAMP_TTL_MS = 10 * 60 * 1000;

export default class HeuristicScanner {
	/** Heuristic scanning timers. */
	private static _scanTimers: Map<Snowflake, NodeJS.Timeout> = new Map();

	/** Last scan timestamps per channel for debouncing. */
	private static _lastScanTimestamps: Map<Snowflake, number> = new Map();

	/** Cleanup interval for stale timestamps. */
	private static _cleanupInterval: NodeJS.Timeout | null = null;

	/** Start the cleanup interval. */
	static startCleanupInterval(): void {
		if (this._cleanupInterval) return;

		this._cleanupInterval = setInterval(() => this._pruneStaleEntries(), 5 * 60 * 1000);
		this._cleanupInterval.unref();
	}

	/** Stop the cleanup interval and clear all timers. */
	static stopCleanupInterval(): void {
		if (this._cleanupInterval) {
			clearInterval(this._cleanupInterval);
			this._cleanupInterval = null;
		}

		// Clear all pending scan timers
		for (const timer of this._scanTimers.values()) {
			clearTimeout(timer);
		}

		this._scanTimers.clear();
		this._lastScanTimestamps.clear();
	}

	/** Remove stale entries from tracking maps. */
	private static _pruneStaleEntries(): void {
		const now = Date.now();
		const cutoff = now - TIMESTAMP_TTL_MS;

		// Prune old timestamps
		for (const [channelId, timestamp] of this._lastScanTimestamps) {
			if (timestamp < cutoff) {
				this._lastScanTimestamps.delete(channelId);
			}
		}

		// Enforce max size with LRU eviction
		if (this._lastScanTimestamps.size > MAX_TIMER_CHANNELS) {
			const entries = Array.from(this._lastScanTimestamps.entries()).sort((a, b) => a[1] - b[1]); // Sort by oldest first

			const toRemove = entries.slice(0, this._lastScanTimestamps.size - MAX_TIMER_CHANNELS);

			for (const [channelId] of toRemove) {
				this._lastScanTimestamps.delete(channelId);
				const timer = this._scanTimers.get(channelId);

				if (timer) {
					clearTimeout(timer);
					this._scanTimers.delete(channelId);
				}
			}
		}
	}

	/**
	 * Calculate if chat rate has increased significantly.
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns True if chat rate has increased, false otherwise.
	 */
	static calculateChatRateIncrease(messages: Message[]): boolean {
		const recentMessages = this.getRecentMessages(messages);
		const previousMessages = this.getPreviousMessages(messages);

		return recentMessages.length - previousMessages.length >= CF_CONSTANTS.MESSAGE_PACE_INCREASE_THRESHOLD;
	}

	/**
	 * Get recent messages within the time range.
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns Recent messages within the defined time range.
	 */
	static getRecentMessages(messages: Message[]): Message[] {
		const now = Date.now();
		return messages.filter(m => m.created_at.getTime() >= now - CF_CONSTANTS.MESSAGE_QUEUE_TIME_RANGE);
	}

	/**
	 * Get previous messages from the window before the current time range.
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns Previous messages from the defined time range.
	 */
	static getPreviousMessages(messages: Message[]): Message[] {
		const now = Date.now();
		return messages.filter(
			m =>
				m.created_at.getTime() >= now - CF_CONSTANTS.MESSAGE_QUEUE_TIME_RANGE * 2 &&
				m.created_at.getTime() < now - CF_CONSTANTS.MESSAGE_QUEUE_TIME_RANGE
		);
	}

	/**
	 * Find messages containing reaction patterns (e.g., uppercase text like "WTF", "OMG").
	 *
	 * @param messages The serialized messages to analyze.
	 * @returns Messages that match reaction patterns.
	 */
	static findReactionMessages(messages: Message[]): Message[] {
		const reactionMessages: Message[] = [];

		for (const m of messages) {
			if (m.content && CF_CONSTANTS.HEURISTIC_REACTION_REGEX.test(m.content)) {
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
	static findMatchingMessages(messages: Message[]): Message[] {
		const matchingMessages: Message[] = [];

		for (let i = 0; i < messages.length - 1; i++) {
			const current = messages[i];
			const next = messages[i + 1];

			if (current.content && next.content && current.author_id !== next.author_id) {
				// Use Levenshtein distance - if distance is less than threshold, consider similar.
				const dist = distance(current.content.toLowerCase(), next.content.toLowerCase());
				const maxLen = Math.max(current.content.length, next.content.length);
				const similarity = 1 - dist / maxLen;

				// Consider messages similar if 80%+ match or distance <= threshold.
				if (similarity >= 0.8 || dist <= CF_CONSTANTS.MESSAGE_DISTANCE_THRESHOLD) {
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
	static async calculateHeuristics(
		reactionMessages: Message[],
		matchingMessages: Message[],
		chatRateIncreased: boolean
	): Promise<HeuristicData> {
		const referenceData: HeuristicMessageData[] = [];

		let standardScore: number = CF_CONSTANTS.DEFAULT_STANDARD_MESSAGE_SCORE;

		for (const message of [...reactionMessages, ...matchingMessages]) {
			if (message.reference_id) {
				const idx = referenceData.findIndex(reference => reference.message.id === message.reference_id);

				if (idx !== -1) {
					referenceData[idx].score++;
				} else {
					// Fetch reference message from Messages.
					const reference = await Messages.get(message.reference_id);

					if (reference) {
						referenceData.push({
							message: reference,
							score: CF_CONSTANTS.DEFAULT_REPLY_MESSAGE_SCORE
						});
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
	static applyHeuristicsToPredictions(
		predictions: ContentPredictions[],
		reactionMessages: Message[],
		matchingMessages: Message[],
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
	static async triggerScan(message: DiscordMessage<true>, config: ValidatedContentFilterConfig): Promise<void> {
		if (!config.enabled || !config.webhook_url) return;

		const channel = message.channel as TextChannel;
		const channelId = channel.id;

		// Check channel scoping.
		const scoping = parseChannelScoping(config.channel_scoping);
		if (!channelInScope(channel, scoping)) return;

		// Access shared channel state from AutomatedScanner.
		const state = AutomatedScanner.getOrInitChannelState(channelId);

		// Use EWMA message-per-minute as chat rate when available.
		const chatRate = Math.max(1, Math.round(state.ewmaMpm ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE));

		// Map chatRate [1..20+] to debounce window between configured min/max.
		let debounceMs = Math.floor(
			CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MIN +
				(Math.min(chatRate, 20) / 20) *
					(CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MAX - CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MIN)
		);
		debounceMs = Math.max(debounceMs, CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MIN_DELAY);

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
	private static async _heuristicScan(channel: TextChannel, config: ValidatedContentFilterConfig): Promise<void> {
		if (!config.enabled || !config.webhook_url) return;

		const channelId = channel.id;
		const state = AutomatedScanner.getOrInitChannelState(channelId);
		const now = Date.now();

		// Update channel timestamps.
		if (!state.scanTimestamps) state.scanTimestamps = [];
		state.scanTimestamps.push(now);

		// Dynamic window size based on observed traffic.
		const traffic = Math.max(1, Math.round(state.ewmaMpm ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE));
		const multiplier = Math.min(
			CF_CONSTANTS.HEURISTIC_DYNAMIC_WINDOW_MULT_MAX,
			traffic / Math.max(1, CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE)
		);
		const dynamicWindow = Math.max(
			CF_CONSTANTS.HEURISTIC_DYNAMIC_WINDOW_MIN,
			Math.round(CF_CONSTANTS.HEURISTIC_WINDOW_SIZE * multiplier)
		);
		const windowSize = Math.min(
			dynamicWindow,
			CF_CONSTANTS.HEURISTIC_WINDOW_SIZE * CF_CONSTANTS.HEURISTIC_DYNAMIC_WINDOW_MULT_MAX
		);

		// Get messages for the channel within the dynamic window.
		const serializedMessages = await Messages.getForChannel(channelId, windowSize);
		if (serializedMessages.length === 0) return;

		const chatRateIncreased = this.calculateChatRateIncrease(serializedMessages);
		const reactionMessages = this.findReactionMessages(serializedMessages);
		const matchingMessages = this.findMatchingMessages(serializedMessages);

		const heur = await this.calculateHeuristics(reactionMessages, matchingMessages, chatRateIncreased);

		const scanRate = state.scanRate ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE;
		const trafficForThreshold = Math.max(1, Math.round(state.ewmaMpm ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE));
		const ratio = trafficForThreshold / Math.max(1, scanRate);
		const dynamicThreshold = Math.max(1, Math.round(CF_CONSTANTS.HEURISTIC_SCORE_THRESHOLD * Math.sqrt(ratio)));

		// Collect candidate message IDs for scanning.
		const candidateIds = new Set<Snowflake>();

		if (heur.standardScore >= dynamicThreshold) {
			const candidateCount = Math.max(
				CF_CONSTANTS.HEURISTIC_MIN_CANDIDATES,
				Math.round(traffic / CF_CONSTANTS.HEURISTIC_CANDIDATE_TRAFFIC_DIVISOR)
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
				const predictions = await ContentFilter.runDetectors(channel, actualMessage, config);

				if (predictions.length) {
					// Update predictions with heuristic data.
					const updatedPredictions = this.applyHeuristicsToPredictions(
						predictions,
						reactionMessages,
						matchingMessages,
						chatRateIncreased
					);

					await ContentFilter.createContentFilterAlert(
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
