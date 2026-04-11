import { distance } from "closest-match";
import type { Message as DiscordMessage, Snowflake, TextChannel } from "discord.js";

import { CF_CONSTANTS } from "#utils/Constants.js";
import { channelInScope, parseChannelScoping } from "#utils/index.js";

import type { Message } from "@repo/db";
import type GuildConfig from "#config/GuildConfig.js";
import type { ParsedContentFilterConfig } from "#config/GuildConfig.js";
import type { HeuristicData, HeuristicMessageData } from "./Types.js";

import MessageManager from "#database/Messages.js";
import Logger from "#utils/Logger.js";
import AutomatedScanner from "./AutomatedScanner.js";

const MAX_TIMER_CHANNELS = 150;
const TIMESTAMP_TTL_MS = 10 * 60 * 1000;

/**
 * Produces heuristic scan candidates based on channel activity patterns.
 */
export default class HeuristicScanner {
	private static _scanTimers = new Map<Snowflake, NodeJS.Timeout>();
	private static _lastScanTimestamps = new Map<Snowflake, number>();
	private static _cleanupInterval: NodeJS.Timeout | null = null;

	/**
	 * Starts periodic cleanup for stale timer and timestamp entries.
	 */
	static startCleanupInterval(): void {
		if (this._cleanupInterval) return;

		this._cleanupInterval = setInterval(() => this._pruneStaleEntries(), 5 * 60 * 1000);
		this._cleanupInterval.unref();
	}

	/**
	 * Stops cleanup and clears all tracked timer state.
	 */
	static stopCleanupInterval(): void {
		if (this._cleanupInterval) {
			clearInterval(this._cleanupInterval);
			this._cleanupInterval = null;
		}

		for (const timer of this._scanTimers.values()) {
			clearTimeout(timer);
		}

		this._scanTimers.clear();
		this._lastScanTimestamps.clear();
	}

	/**
	 * Returns lightweight diagnostics for currently tracked heuristic timers.
	 *
	 * @returns Timer and tracked-channel counters.
	 */
	static getDiagnostics(): { timers: number; trackedChannels: number } {
		return {
			timers: this._scanTimers.size,
			trackedChannels: this._lastScanTimestamps.size
		};
	}

	/**
	 * Debounces and schedules a heuristic scan for a message's channel.
	 *
	 * @param message The source Discord message.
	 * @param guildConfig Guild configuration used to resolve filter settings.
	 */
	static async triggerScan(
		message: DiscordMessage<true>,
		guildConfig: GuildConfig
	): Promise<void> {
		const config = guildConfig.parseContentFilterConfig();
		if (!config) return;
		if (!config.use_heuristic_scanner) return;

		const channel = message.channel as TextChannel;
		const channelId = channel.id;
		const scoping = parseChannelScoping(config.channel_scoping);
		if (!channelInScope(channel, scoping)) return;

		const state = AutomatedScanner.getOrInitChannelState(channelId, channel.guildId);
		const chatRate = Math.max(1, Math.round(state.ewmaMpm));

		let debounceMs = Math.floor(
			CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MIN +
				(Math.min(chatRate, 20) / 20) *
					(CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MAX -
						CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MIN)
		);
		debounceMs = Math.max(debounceMs, CF_CONSTANTS.HEURISTIC_SCAN_DEBOUNCE_MIN_DELAY);

		const now = Date.now();
		const lastScan = this._lastScanTimestamps.get(channelId) ?? 0;
		const timeSinceLastScan = now - lastScan;
		const hardCooldownMs = CF_CONSTANTS.HEURISTIC_CHANNEL_SCAN_COOLDOWN_MS;

		if (this._scanTimers.has(channelId)) return;

		let delay = debounceMs;
		if (timeSinceLastScan < debounceMs) {
			delay = debounceMs - timeSinceLastScan;
		}

		if (timeSinceLastScan < hardCooldownMs) {
			delay = Math.max(delay, hardCooldownMs - timeSinceLastScan);
		}

		const timer = setTimeout(() => {
			this._lastScanTimestamps.set(channelId, Date.now());
			void this._heuristicScan(channel, config).catch(error => {
				Logger.error("CF heuristic scan failed:", error);
			});
			this._scanTimers.delete(channelId);
		}, delay);

		this._scanTimers.set(channelId, timer);
	}

	/**
	 * Detects whether recent channel pace increased versus the previous window.
	 *
	 * @param messages Channel messages used for pace comparison.
	 * @returns True when pace increase exceeds configured threshold.
	 */
	static calculateChatRateIncrease(messages: Message[]): boolean {
		const recent = this.getRecentMessages(messages);
		const previous = this.getPreviousMessages(messages);

		return recent.length - previous.length >= CF_CONSTANTS.MESSAGE_PACE_INCREASE_THRESHOLD;
	}

	/**
	 * Returns messages in the most recent heuristic time window.
	 *
	 * @param messages Candidate message list.
	 * @returns Messages from the recent window.
	 */
	static getRecentMessages(messages: Message[]): Message[] {
		const now = Date.now();
		return messages.filter(
			m => m.created_at.getTime() >= now - CF_CONSTANTS.MESSAGE_QUEUE_TIME_RANGE
		);
	}

	/**
	 * Returns messages in the prior window preceding the recent one.
	 *
	 * @param messages Candidate message list.
	 * @returns Messages from the previous window.
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
	 * Finds reaction-like short messages used as a heuristic signal.
	 *
	 * @param messages Candidate message list.
	 * @returns Messages matching reaction-like patterns.
	 */
	static findReactionMessages(messages: Message[]): Message[] {
		return messages.filter(message => {
			if (!message.content) return false;

			const normalized = message.content.trim();
			if (!normalized) return false;
			if (normalized.length > CF_CONSTANTS.HEURISTIC_REACTION_MAX_LENGTH) return false;
			if (this._countWords(normalized) > CF_CONSTANTS.HEURISTIC_REACTION_MAX_WORDS) {
				return false;
			}

			return (
				CF_CONSTANTS.HEURISTIC_REACTION_REGEX.test(normalized) ||
				/[!?]{2,}/.test(normalized)
			);
		});
	}

	/**
	 * Finds near-duplicate adjacent messages from different users.
	 *
	 * @param messages Candidate message list.
	 * @returns Matched near-duplicate messages.
	 */
	static findMatchingMessages(messages: Message[]): Message[] {
		const matching: Message[] = [];

		for (let i = 0; i < messages.length - 1; i++) {
			const current = messages[i];
			const next = messages[i + 1];

			if (!current.content || !next.content || current.author_id === next.author_id) {
				continue;
			}

			if (
				!this._isHeuristicComparableContent(current.content) ||
				!this._isHeuristicComparableContent(next.content)
			) {
				continue;
			}

			const dist = distance(current.content.toLowerCase(), next.content.toLowerCase());
			const maxLen = Math.max(current.content.length, next.content.length);
			const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;

			if (similarity >= 0.9 || dist <= CF_CONSTANTS.MESSAGE_DISTANCE_THRESHOLD) {
				matching.push(current);
			}
		}

		return matching;
	}

	/**
	 * Calculates aggregate heuristic scores used for candidate collection.
	 *
	 * @param reactionMessages Messages that matched reaction heuristics.
	 * @param matchingMessages Messages that matched similarity heuristics.
	 * @param chatRateIncreased Whether message pace increased in the current window.
	 * @returns Heuristic scoring data for standard and reference candidates.
	 */
	static async calculateHeuristics(
		reactionMessages: Message[],
		matchingMessages: Message[],
		chatRateIncreased: boolean
	): Promise<HeuristicData> {
		const referenceData: HeuristicMessageData[] = [];
		let standardScore = CF_CONSTANTS.DEFAULT_STANDARD_MESSAGE_SCORE;

		for (const message of [...reactionMessages, ...matchingMessages]) {
			if (message.reference_id) {
				const existing = referenceData.find(
					item => item.message.id === message.reference_id
				);
				if (existing) {
					existing.score++;
				} else {
					const ref = await MessageManager.get(message.reference_id);
					if (ref) {
						referenceData.push({
							message: ref,
							score: CF_CONSTANTS.DEFAULT_REPLY_MESSAGE_SCORE
						});
					}
				}
			} else {
				standardScore++;
			}
		}

		const hasStrongSignal = reactionMessages.length >= 2 || matchingMessages.length >= 2;

		if (chatRateIncreased && hasStrongSignal) {
			standardScore++;
			for (const reference of referenceData) {
				reference.score++;
			}
		}

		return {
			standardScore,
			referenceData
		};
	}

	/**
	 * Prunes stale timestamp state and enforces tracker limits.
	 */
	private static _pruneStaleEntries(): void {
		const now = Date.now();
		const cutoff = now - TIMESTAMP_TTL_MS;

		for (const [channelId, ts] of this._lastScanTimestamps.entries()) {
			if (ts < cutoff) {
				this._lastScanTimestamps.delete(channelId);
			}
		}

		if (this._lastScanTimestamps.size > MAX_TIMER_CHANNELS) {
			const oldest = [...this._lastScanTimestamps.entries()].sort((a, b) => a[1] - b[1]);
			const toRemove = oldest.slice(0, this._lastScanTimestamps.size - MAX_TIMER_CHANNELS);

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
	 * Executes heuristic scanning for a single channel and enqueues scan candidates.
	 *
	 * @param channel The channel being scanned.
	 * @param config Parsed content-filter configuration.
	 */
	private static async _heuristicScan(
		channel: TextChannel,
		config: ParsedContentFilterConfig
	): Promise<void> {
		if (!config.enabled || !config.webhook_url) return;

		const channelId = channel.id;
		const state = AutomatedScanner.getOrInitChannelState(channelId, channel.guildId);
		const now = Date.now();
		state.scanTimestamps.push(now);

		const traffic = Math.max(1, Math.round(state.ewmaMpm));
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

		const serializedMessages = await MessageManager.getForChannel(channelId, windowSize);
		if (serializedMessages.length === 0) return;

		const chatRateIncreased = this.calculateChatRateIncrease(serializedMessages);
		const reactionMessages = this.findReactionMessages(serializedMessages);
		const matchingMessages = this.findMatchingMessages(serializedMessages);

		// Pace-only spikes are noisy; require at least one direct content signal.
		if (reactionMessages.length === 0 && matchingMessages.length === 0) {
			return;
		}

		const signalScore = reactionMessages.length * 2 + matchingMessages.length;
		if (signalScore < CF_CONSTANTS.HEURISTIC_MIN_SIGNAL_SCORE) {
			return;
		}

		const heuristic = await this.calculateHeuristics(
			reactionMessages,
			matchingMessages,
			chatRateIncreased
		);

		const dynamicThreshold = this._computeDynamicThreshold(state.scanRate, state.ewmaMpm);
		const candidates = this._collectCandidateMessages(
			serializedMessages,
			heuristic,
			dynamicThreshold,
			traffic,
			reactionMessages,
			matchingMessages
		);

		if (candidates.size === 0) return;

		const heuristicSignals = this._buildHeuristicSignals(
			reactionMessages.length,
			matchingMessages.length,
			chatRateIncreased
		);

		let queued = 0;
		for (const messageId of candidates) {
			const actualMessage =
				AutomatedScanner.getCachedMessage(messageId) ??
				(await channel.messages.fetch(messageId).catch(() => null));

			if (!actualMessage || !actualMessage.inGuild()) continue;
			if (
				config.immune_roles.length > 0 &&
				actualMessage.member?.roles.cache.hasAny(...config.immune_roles)
			) {
				continue;
			}

			const risk = this._estimateHeuristicRisk(heuristicSignals.length, dynamicThreshold);
			AutomatedScanner.enqueueHeuristicCandidate(
				actualMessage,
				config,
				heuristicSignals,
				risk
			);
			queued++;
		}

		if (queued > 0) {
			Logger.custom(
				"CF",
				JSON.stringify({
					event: "heuristic_candidates_queued",
					channelId,
					queued,
					signals: heuristicSignals,
					threshold: dynamicThreshold
				})
			);
		}
	}

	/**
	 * Computes a dynamic threshold from traffic-to-scan-rate ratio.
	 *
	 * @param scanRate Effective scan rate for the channel.
	 * @param ewmaMpm EWMA message rate for the channel.
	 * @returns Dynamic threshold used for candidate selection.
	 */
	private static _computeDynamicThreshold(scanRate: number, ewmaMpm: number): number {
		const traffic = Math.max(1, Math.round(ewmaMpm));
		const ratio = traffic / Math.max(1, scanRate);
		return Math.max(1, Math.round(CF_CONSTANTS.HEURISTIC_SCORE_THRESHOLD * Math.sqrt(ratio)));
	}

	/**
	 * Collects candidate message IDs that exceed heuristic thresholds.
	 *
	 * @param serializedMessages Channel message history under analysis.
	 * @param heuristic Aggregate heuristic data.
	 * @param dynamicThreshold Threshold required for candidate inclusion.
	 * @param traffic Current traffic estimate for candidate scaling.
	 * @returns Set of candidate message IDs to enqueue.
	 */
	private static _collectCandidateMessages(
		serializedMessages: Message[],
		heuristic: HeuristicData,
		dynamicThreshold: number,
		traffic: number,
		reactionMessages: Message[],
		matchingMessages: Message[]
	): Set<Snowflake> {
		const candidates = new Set<Snowflake>();
		const signalIds = new Set<Snowflake>([
			...reactionMessages.map(message => message.id),
			...matchingMessages.map(message => message.id)
		]);

		if (heuristic.standardScore >= dynamicThreshold && signalIds.size > 0) {
			const count = Math.max(
				CF_CONSTANTS.HEURISTIC_MIN_CANDIDATES,
				Math.round(traffic / CF_CONSTANTS.HEURISTIC_CANDIDATE_TRAFFIC_DIVISOR)
			);
			const candidateLimit = Math.min(
				signalIds.size,
				count,
				CF_CONSTANTS.HEURISTIC_MAX_CANDIDATES_PER_SCAN
			);
			for (const message of serializedMessages) {
				if (!signalIds.has(message.id)) continue;
				candidates.add(message.id);
				if (candidates.size >= candidateLimit) break;
			}
		}

		for (const ref of heuristic.referenceData) {
			if (ref.score >= dynamicThreshold) {
				candidates.add(ref.message.id);
			}
		}

		return candidates;
	}

	/**
	 * Builds human-readable heuristic signals for diagnostics and alert metadata.
	 *
	 * @param reactionCount Count of reaction-like matches.
	 * @param matchingCount Count of near-duplicate matches.
	 * @param chatRateIncreased Whether pacing increased in the current window.
	 * @returns Signal messages describing triggered heuristic conditions.
	 */
	private static _buildHeuristicSignals(
		reactionCount: number,
		matchingCount: number,
		chatRateIncreased: boolean
	): string[] {
		const signals: string[] = [];
		if (reactionCount > 0) {
			signals.push(`Heuristic: ${reactionCount} reaction-like messages detected`);
		}
		if (matchingCount > 0) {
			signals.push(`Heuristic: ${matchingCount} near-duplicate messages detected`);
		}
		if (chatRateIncreased) {
			signals.push("Heuristic: message pace increase detected");
		}

		return signals;
	}

	/**
	 * Estimates enqueue risk for heuristic candidates.
	 *
	 * @param signalCount Number of heuristic signals detected.
	 * @param threshold Dynamic threshold used for scoring.
	 * @returns Normalized risk value in the range [0, 1].
	 */
	private static _estimateHeuristicRisk(signalCount: number, threshold: number): number {
		const signalBoost = Math.min(0.35, signalCount * 0.12);
		const thresholdBoost = Math.min(0.25, 1 / Math.max(1, threshold));
		return Math.min(1, 0.6 + signalBoost + thresholdBoost);
	}

	/**
	 * Checks whether a message content is suitable for similarity-based heuristic matching.
	 *
	 * @param content Message content to evaluate.
	 * @returns True when content is short and reaction-like enough for matching checks.
	 */
	private static _isHeuristicComparableContent(content: string): boolean {
		const normalized = content.trim();
		if (!normalized) return false;
		if (normalized.length > CF_CONSTANTS.HEURISTIC_MATCH_MAX_LENGTH) return false;
		if (this._countWords(normalized) > CF_CONSTANTS.HEURISTIC_MATCH_MAX_WORDS) {
			return false;
		}

		return true;
	}

	/**
	 * Counts whitespace-separated words in a message content string.
	 *
	 * @param content Message content to evaluate.
	 * @returns Word count for the provided content.
	 */
	private static _countWords(content: string): number {
		const matches = content.match(/\S+/g);
		return matches ? matches.length : 0;
	}
}
