import { Colors, EmbedBuilder, Message, Snowflake, TextChannel, WebhookClient } from "discord.js";

import { ScanTypes } from "./Enums.js";
import { CF_CONSTANTS } from "#utils/Constants.js";
import { ChannelScoping } from "#utils/Types.js";
import { channelInScope, userMentionWithId } from "#utils/index.js";

import type { ChannelScanState, ContentPredictions } from "./Types.js";
import type { Message as SerializedMessage, ContentFilterConfig } from "#prisma/client.js";

import Logger from "#utils/Logger.js";
import MinimumHeap from "#structures/MinimumHeap.js";
import ContentFilter from "./ContentFilter.js";
import ConfigManager from "#managers/config/ConfigManager.js";
import ContentFilterUtils from "#utils/ContentFilter.js";

export default class AutomatedScanner {
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
		this._tickInterval = setInterval(() => this.tick(), CF_CONSTANTS.HEURISTIC_TICK_INTERVAL_MS);
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
				scanRate: CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
				ewmaMpm: CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
				loggedRateEwma: CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
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

		if (!channelInScope(message.channel, scoping)) return;

		const now = Date.now();
		const state = this.getOrInitChannelState(message.channel.id);

		if (!state.messageTimestamps) state.messageTimestamps = [];
		state.messageTimestamps.push(now);
		state.messageTimestamps = state.messageTimestamps.filter(
			(ts: number) => now - ts <= CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
		);

		const measuredMpm = state.messageTimestamps.length;
		state.ewmaMpm = this._ewma(state.ewmaMpm, measuredMpm, CF_CONSTANTS.HEURISTIC_EWMA_MPM_ALPHA);

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
			CF_CONSTANTS.HEURISTIC_MAX_SCAN_RATE,
			Math.max(CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE, this._aggregateChannelScanRateEstimate())
		);
		const scansPerSecond = globalRate / 60;
		const tickDuration = CF_CONSTANTS.HEURISTIC_TICK_INTERVAL_MS;
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
					const predictions = await ContentFilter.runDetectors(
						entry.message.channel,
						entry.message,
						contentFilterConfig
					);

					if (predictions.length > 0) {
						await ContentFilter.createContentFilterAlert(
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

		const targetA = prevA + Math.min(CF_CONSTANTS.HEURISTIC_MAX_BETA_INCREMENT_PER_CALL, incA);
		const targetB = prevB + Math.min(CF_CONSTANTS.HEURISTIC_MAX_BETA_INCREMENT_PER_CALL, incB);

		state.betaA = Math.max(
			1,
			prevA * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
				targetA * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA
		);
		state.betaB = Math.max(
			1,
			prevB * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
				targetB * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA
		);

		const mean = this._betaMean(state);

		this._smoothedFalsePositive.set(
			channelId,
			(this._smoothedFalsePositive.get(channelId) ?? 0) * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
				mean * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA
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
		const predictions = await ContentFilter.runDetectors(channel, message, config);

		if (predictions.length > 0) {
			// Update state with predictions.
			await this.applyPredictionsToState(state, message.author.id, predictions, now, riskScore, smoothed);

			// Create alert.
			await ContentFilter.createContentFilterAlert(predictions, ScanTypes.Automated, message, config);

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
		this.cleanupOldTimestamps(state, now, CF_CONSTANTS.CONTENT_FILTER_ALERT_TTL);

		if (!state.userScores) state.userScores = new Map();
		if (!state.priorityAlertedUsers) state.priorityAlertedUsers = new Set();

		let effectiveRisk = options?.risk;
		let trafficEstimate = CF_CONSTANTS.HEURISTIC_DEFAULT_TRAFFIC_ESTIMATE;
		let falsePositiveRatio = 0;

		try {
			const traffic = Math.max(1, Math.round(state.ewmaMpm ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE));
			const windowMs = Math.max(
				CF_CONSTANTS.HEURISTIC_WINDOW_MIN_MS,
				Math.min(
					CF_CONSTANTS.HEURISTIC_WINDOW_MAX_MS,
					Math.round(
						CF_CONSTANTS.HEURISTIC_WINDOW_BASE_MS * (CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE / traffic)
					)
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
			trafficEstimate = Math.max(1, Math.round(state.ewmaMpm ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE));

			if (highestScore && effectiveRisk === undefined) {
				effectiveRisk = Math.min(1, highestScore / 10);
			}
		} catch {
			// Ignore errors and use defaults.
		}

		const prevSmoothed = this._smoothedFalsePositive.get(channelId) ?? 0;
		const smoothed =
			prevSmoothed * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
			falsePositiveRatio * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA;
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
				const samplingFactor = Math.min(1, Math.max(CF_CONSTANTS.HEURISTIC_MIN_SAMPLING_FACTOR, riskScore));
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
		const ewmaMpm = state.ewmaMpm ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE;
		const beta = this._betaMean(state);

		const raw = Math.round(
			CF_CONSTANTS.HEURISTIC_K_TRAFFIC * ewmaMpm +
				CF_CONSTANTS.HEURISTIC_K_CONF * (1 - beta) * CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE
		);

		return Math.max(
			1,
			Math.min(CF_CONSTANTS.HEURISTIC_MAX_SCAN_RATE, raw || CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE)
		);
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
			(CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_BASE +
				severity * CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_SEVERITY_MULT) *
			(1 + Math.min(1, riskScore));

		return Math.max(
			CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_MAX, w)
		);
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
			(ts: number) => now - ts < CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
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
				const decayFactor = Math.exp(
					-Math.LN2 * (dt / Math.max(1, CF_CONSTANTS.HEURISTIC_BETA_DECAY_HALF_LIFE_MS))
				);
				state.betaA = Math.max(1, (state.betaA ?? 1) * decayFactor);
				state.betaB = Math.max(1, (state.betaB ?? 1) * decayFactor);
				state.betaLastUpdate = now;
			}
		} catch {
			// Ignore decay errors.
		}

		const beta = this._betaMean(state);
		const ewmaMpm = Math.max(1, Math.round(state.ewmaMpm ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE));

		const trafficScale = 1 + Math.min(2, Math.log10(1 + ewmaMpm) * 0.25);
		let Kp = CF_CONSTANTS.HEURISTIC_PID_BASE_KP * (1 + (1 - Math.min(1, beta)) * 0.4) * trafficScale;
		Kp = Math.max(CF_CONSTANTS.HEURISTIC_PID_KP_MIN, Math.min(CF_CONSTANTS.HEURISTIC_PID_KP_MAX, Kp));

		let Ki = CF_CONSTANTS.HEURISTIC_PID_BASE_KI / Math.max(1, Math.log10(1 + ewmaMpm) * 0.5);
		Ki = Math.max(CF_CONSTANTS.HEURISTIC_PID_KI_MIN, Math.min(CF_CONSTANTS.HEURISTIC_PID_KI_MAX, Ki));

		let Kd = CF_CONSTANTS.HEURISTIC_PID_BASE_KD * (1 + Math.min(1, Math.log10(1 + ewmaMpm) * 0.1));
		Kd = Math.max(CF_CONSTANTS.HEURISTIC_PID_KD_MIN, Math.min(CF_CONSTANTS.HEURISTIC_PID_KD_MAX, Kd));

		const maxStep = Math.max(
			1,
			Math.round(CF_CONSTANTS.HEURISTIC_RATE_INCREASE_STEP * (1 + (1 - Math.min(1, smoothedFalsePositive))))
		);

		const baseRate = this.getDynamicBaseScanRateForState(state);
		const minRate = Math.max(CF_CONSTANTS.HEURISTIC_MIN_SCAN_RATE, baseRate);

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
		state.scanRate = Math.max(minRate, Math.min(CF_CONSTANTS.HEURISTIC_MAX_SCAN_RATE, state.scanRate + step));

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

		if (
			state.scanRate > baseRate &&
			now - state.lastRateIncrease > CF_CONSTANTS.HEURISTIC_RATE_INCREASE_DURATION
		) {
			state.scanRate = Math.max(
				baseRate,
				Math.round(
					state.scanRate * CF_CONSTANTS.HEURISTIC_RATE_DECAY_A +
						baseRate * CF_CONSTANTS.HEURISTIC_RATE_DECAY_B
				)
			);
			state.lastRateIncrease = now;
			state.alertCount = 0;
			changed = true;
		}

		const newRate = state.scanRate;
		const loggedEwmaPrev = state.loggedRateEwma ?? oldRate;
		const absChangeFromLogged = Math.abs(newRate - loggedEwmaPrev);
		const significantChange = absChangeFromLogged >= CF_CONSTANTS.HEURISTIC_MIN_ABS_CHANGE_FOR_LOG;
		const lastLog = state.lastRateLog ?? 0;

		let shouldLog = false;
		if (changed && significantChange) {
			if (!lastLog) {
				state.lastRateLog = now;
				shouldLog = false;
			} else if (now - lastLog > CF_CONSTANTS.HEURISTIC_RATE_CHANGE_INTERVAL) {
				shouldLog = true;
				state.lastRateLog = now;
			}
		}

		state.loggedRateEwma = Math.round(
			loggedEwmaPrev * (1 - CF_CONSTANTS.HEURISTIC_LOGGING_SMOOTH_ALPHA) +
				newRate * CF_CONSTANTS.HEURISTIC_LOGGING_SMOOTH_ALPHA
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
		state.scanTimestamps = state.scanTimestamps.filter(
			(ts: number) => now - ts < CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
		);

		if (state.flaggedUsers) {
			for (const [userId, timestamps] of state.flaggedUsers.entries()) {
				const pruned = timestamps.filter((ts: number) => now - ts < CF_CONSTANTS.HEURISTIC_SCAN_WINDOW);

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

				if (
					(entry.score ?? 0) <= CF_CONSTANTS.HEURISTIC_SCORE_PRUNE_EPSILON &&
					now - lastScan > CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
				) {
					state.userScores.delete(userId);
				}
			}

			for (const [userId, entry] of state.userScores.entries()) {
				const lastScan = entry?.lastScan ?? 0;

				if (now - lastScan > ttl) {
					state.userScores.delete(userId);
				}
			}

			if (state.userScores.size > CF_CONSTANTS.HEURISTIC_USER_SCORES_MAX_SIZE) {
				const candidates: Array<[Snowflake, number]> = Array.from(state.userScores.entries()).map(
					([uid, entry]) => [uid, entry?.lastScan ?? 0]
				);
				candidates.sort((a, b) => a[1] - b[1]);

				const target = Math.floor(CF_CONSTANTS.HEURISTIC_USER_SCORES_MAX_SIZE * 0.9);

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
		const msgsPerMinute = Math.max(CF_CONSTANTS.HEURISTIC_MIN_SCAN_RATE, Math.round(effective));
		const baseInterval = CF_CONSTANTS.HEURISTIC_SCAN_WINDOW / msgsPerMinute;

		const riskClamped = Math.max(0, Math.min(1, risk));
		const multiplier =
			CF_CONSTANTS.HEURISTIC_RISK_MULTIPLIER_MIN +
			(1 - riskClamped) *
				(CF_CONSTANTS.HEURISTIC_RISK_MULTIPLIER_MAX - CF_CONSTANTS.HEURISTIC_RISK_MULTIPLIER_MIN);

		const jitterMax = Math.min(1000, Math.floor(baseInterval * CF_CONSTANTS.HEURISTIC_JITTER_PCT));
		const jitter = Math.floor(Math.random() * Math.max(0, jitterMax));

		return (
			now + Math.max(CF_CONSTANTS.HEURISTIC_MIN_SCHEDULE_DELAY, Math.floor(baseInterval * multiplier)) + jitter
		);
	}

	private static _ewma(prev: number | undefined, value: number, alpha = CF_CONSTANTS.HEURISTIC_EWMA_ALPHA): number {
		if (prev === undefined || prev === null) return value;
		return prev * (1 - alpha) + value * alpha;
	}

	private static _betaMean(state: ChannelScanState): number {
		const a = state.betaA ?? 1;
		const b = state.betaB ?? 1;
		const mean = a / (a + b);
		return Math.max(CF_CONSTANTS.HEURISTIC_BETA_MEAN_MIN, Math.min(CF_CONSTANTS.HEURISTIC_BETA_MEAN_MAX, mean));
	}

	private static _aggregateChannelScanRateEstimate(): number {
		if (this._channelScanStates.size === 0) return CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE;

		let total = 0;
		let count = 0;

		for (const [, s] of this._channelScanStates.entries()) {
			total += this.getDynamicBaseScanRateForState(s) ?? CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE;
			count++;
		}

		return Math.max(CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE, Math.round(total / Math.max(1, count)));
	}

	private static _computeDecayFactor(state: ChannelScanState, smoothedFalsePositive: number): number {
		const base = CF_CONSTANTS.HEURISTIC_DECAY_BASE;
		const fpInfluence = Math.min(
			CF_CONSTANTS.HEURISTIC_DECAY_FP_INFLUENCE_MAX,
			smoothedFalsePositive * CF_CONSTANTS.HEURISTIC_DECAY_FP_INFLUENCE_FACTOR
		);

		const alertInfluence = Math.min(
			CF_CONSTANTS.HEURISTIC_DECAY_ALERT_INFLUENCE_MAX,
			(state.alertCount || 0) * CF_CONSTANTS.HEURISTIC_DECAY_ALERT_INFLUENCE_PER_ALERT
		);

		return Math.max(
			CF_CONSTANTS.HEURISTIC_DECAY_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_DECAY_MAX, base - fpInfluence - alertInfluence)
		);
	}

	/**
	 * Compute a dynamic priority threshold (how many score units to become a priority user).
	 *
	 * @param state The channel scan state.
	 * @param smoothedFalsePositive The smoothed false positive ratio for the channel.
	 * @returns The computed priority threshold.
	 */
	public static computePriorityThreshold(state: ChannelScanState, smoothedFalsePositive: number): number {
		const base = CF_CONSTANTS.HEURISTIC_PRIORITY_USER_FLAG_THRESHOLD || 2;
		const multiplier =
			1 +
			Math.min(
				CF_CONSTANTS.HEURISTIC_PRIORITY_MULT_MAX,
				smoothedFalsePositive * CF_CONSTANTS.HEURISTIC_PRIORITY_MULT_FACTOR
			);
		const recentAlerts = state.scanTimestamps ? state.scanTimestamps.length : 0;
		const recentInfluence = Math.max(
			0,
			1 - Math.min(0.5, recentAlerts / CF_CONSTANTS.HEURISTIC_RECENT_ALERTS_CAP)
		);
		return Math.max(1, Math.ceil(base * multiplier * recentInfluence));
	}

	private static _estimateAdaptiveThreshold(timestamps: number[], now: number): number {
		if (!timestamps || timestamps.length === 0) return 1;

		const alpha = Math.max(0, Math.min(1, CF_CONSTANTS.HEURISTIC_ADAPTIVE_DECAY_ALPHA));
		const hist = new Map<number, number>();
		let totalWeight = 0;

		for (let i = 0; i < CF_CONSTANTS.HEURISTIC_ADAPTIVE_P95_WINDOWS; i++) {
			const start = now - (i + 1) * CF_CONSTANTS.HEURISTIC_SCAN_WINDOW;
			const end = now - i * CF_CONSTANTS.HEURISTIC_SCAN_WINDOW;
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
