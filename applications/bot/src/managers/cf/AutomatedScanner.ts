import {
	Colors,
	EmbedBuilder,
	type Message,
	type Snowflake,
	TextChannel,
	WebhookClient
} from "discord.js";
import type { Moderation } from "openai/resources/moderations";

import { client, kysely } from "#root/index.js";
import { CF_CONSTANTS } from "#utils/Constants.js";
import { channelInScope, parseChannelScoping, userMentionWithId } from "#utils/index.js";
import { RetryableScanError } from "./ContentFilter.js";
import { ScanTypes } from "./Enums.js";

import type { Message as SerializedMessage } from "@repo/db";
import type GuildConfig from "#config/GuildConfig.js";
import type { ParsedContentFilterConfig } from "#config/GuildConfig.js";
import type { ChannelScanState, ContentPredictions, ScanJob } from "./Types.js";

import ConfigManager from "#config/ConfigManager.js";
import ContentFilterUtils from "#utils/ContentFilter.js";
import Logger from "#utils/Logger.js";

import ContentFilter from "./ContentFilter.js";
import DeadLetterStore from "./DeadLetterStore.js";
import ScanJobScheduler from "./ScanJobScheduler.js";
import StateStore from "./StateStore.js";

const MESSAGE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const MESSAGE_CACHE_MAX_SIZE = 12_000;

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const METRICS_LOG_INTERVAL_MS = 60 * 1000;
const HEARTBEAT_FORCED_LOG_INTERVAL_MS = 10 * 60 * 1000;

const MAX_RETRIES = 3;
const MAX_CONCURRENT_SCAN_JOBS = 4;
const RETRY_BASE_DELAY_MS = 8_000;
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;
const LOW_PRIORITY_DROP_QUEUE_SIZE = 500;
const LOW_PRIORITY_DROP_RISK_THRESHOLD = 0.4;
const LOW_PRIORITY_DROP_LOG_WINDOW_MS = 30 * 1000;
const MAX_GUILD_QUEUE_DEPTH = 50;
const TEXT_PREFETCH_MIN_BATCH_SIZE = 2;
const TEXT_PREFETCH_FALLBACK_PAUSE_MS = 15_000;
const TEXT_PREFETCH_OPENAI_MAX_RETRIES = 1;
const FORCE_COOLDOWN_BYPASS_WINDOW_MS = 5_000;
const OPENAI_RATE_LIMIT_MIN_RETRY_MS = 15_000;
const OPENAI_RATE_LIMIT_MIN_RETRY_MS_FORCED = 5_000;

/**
 * Coordinates adaptive content-filter job scheduling, execution, and feedback loops.
 */
export default class AutomatedScanner {
	private static _stateStore = new StateStore();
	private static _scheduler = new ScanJobScheduler();

	private static _tickInterval: NodeJS.Timeout | null = null;
	private static _cleanupInterval: NodeJS.Timeout | null = null;
	private static _metricsInterval: NodeJS.Timeout | null = null;

	private static _messageCache = new Map<
		Snowflake,
		{ message: Message<true>; cachedAt: number }
	>();
	private static _pidByChannel = new Map<
		Snowflake,
		{ integral: number; lastError: number; lastUpdate: number }
	>();
	private static _openAiRateLimitLogWindowUntil = 0;
	private static _lastHeartbeatLogAt = 0;
	private static _prioritizedGuilds = new Set<Snowflake>();
	private static _tickInFlight = false;
	private static _lowPriorityDropLogWindowUntil = 0;
	private static _activeJobCount = 0;
	private static _textPrefetchPausedUntil = 0;

	/**
	 * Starts scheduler processing, cache pruning, and heartbeat logging intervals.
	 */
	static startTickLoop(): void {
		if (this._tickInterval) return;

		this._tickInterval = setInterval(() => {
			if (this._tickInFlight) return;

			this._tickInFlight = true;
			void this._tick()
				.catch(error => {
					Logger.error("CF tick loop failed:", error);
				})
				.finally(() => {
					this._tickInFlight = false;
				});
		}, CF_CONSTANTS.HEURISTIC_TICK_INTERVAL_MS);

		if (!this._cleanupInterval) {
			this._cleanupInterval = setInterval(() => {
				this._stateStore.prune();
				this._pruneMessageCache();
			}, CLEANUP_INTERVAL_MS);
			this._cleanupInterval.unref();
		}

		if (!this._metricsInterval) {
			this._metricsInterval = setInterval(() => {
				const queue = this._scheduler.snapshot();
				const deadLetters = DeadLetterStore.getSummary();
				const now = Date.now();
				const hasActiveSignal = queue.total > 0 || deadLetters.buffered > 0;

				if (
					!hasActiveSignal &&
					now - this._lastHeartbeatLogAt < HEARTBEAT_FORCED_LOG_INTERVAL_MS
				) {
					return;
				}

				this._lastHeartbeatLogAt = now;

				Logger.custom(
					"CF",
					JSON.stringify({
						event: "heartbeat",
						states: this._stateStore.count(),
						messageCache: this._messageCache.size,
						activeJobs: this._activeJobCount,
						openAiCooldownMs: ContentFilter.getOpenAiRateLimitCooldownMs(),
						textPrefetchPauseMs: Math.max(0, this._textPrefetchPausedUntil - now),
						queue,
						deadLetters
					})
				);
			}, METRICS_LOG_INTERVAL_MS);
			this._metricsInterval.unref();
		}
	}

	/**
	 * Stops all scanner intervals and background loops.
	 */
	static stopTickLoop(): void {
		if (this._tickInterval) {
			clearInterval(this._tickInterval);
			this._tickInterval = null;
		}

		this._tickInFlight = false;
		this._activeJobCount = 0;

		if (this._cleanupInterval) {
			clearInterval(this._cleanupInterval);
			this._cleanupInterval = null;
		}

		if (this._metricsInterval) {
			clearInterval(this._metricsInterval);
			this._metricsInterval = null;
		}
	}

	/**
	 * Returns a cached message when available and still fresh.
	 *
	 * @param messageId The message identifier.
	 * @returns Cached message instance, or null when missing/stale.
	 */
	static getCachedMessage(messageId: Snowflake): Message<true> | null {
		const entry = this._messageCache.get(messageId);
		if (!entry) return null;

		if (Date.now() - entry.cachedAt > MESSAGE_CACHE_MAX_AGE_MS) {
			this._messageCache.delete(messageId);
			return null;
		}

		return entry.message;
	}

	/**
	 * Stores a message in the short-lived in-memory message cache.
	 *
	 * @param message Message to cache.
	 */
	static cacheMessage(message: Message<true>): void {
		this._messageCache.set(message.id, { message, cachedAt: Date.now() });
	}

	/**
	 * Returns channel state or initializes a new state entry.
	 *
	 * @param channelId Channel identifier.
	 * @param guildId Optional guild identifier for state attribution.
	 * @returns Channel scan state entry.
	 */
	static getOrInitChannelState(channelId: Snowflake, guildId?: Snowflake): ChannelScanState {
		return this._stateStore.getOrInit(channelId, guildId);
	}

	/**
	 * Enables or disables manual scan prioritization for a guild.
	 *
	 * @param guildId Guild identifier.
	 * @param enabled Whether prioritization should be enabled.
	 */
	static async setGuildPriority(guildId: Snowflake, enabled: boolean): Promise<void> {
		if (enabled) {
			await kysely
				.insertInto("ContentFilterPriority")
				.values({ id: guildId })
				.onConflict(conflict => conflict.column("id").doNothing())
				.execute();

			this._prioritizedGuilds.add(guildId);
			return;
		}

		await kysely
			.deleteFrom("ContentFilterPriority")
			.where("id", "=", guildId)
			.executeTakeFirst();

		this._prioritizedGuilds.delete(guildId);
	}

	/**
	 * Checks whether a guild has manual scan prioritization enabled.
	 *
	 * @param guildId Guild identifier.
	 * @returns True when prioritization is enabled for the guild.
	 */
	static isPrioritizedGuild(guildId: Snowflake): boolean {
		return this._prioritizedGuilds.has(guildId);
	}

	/**
	 * Returns all guild IDs with manual prioritization enabled.
	 *
	 * @returns Prioritized guild identifier list.
	 */
	static getPrioritizedGuilds(): Snowflake[] {
		return [...this._prioritizedGuilds.values()];
	}

	/**
	 * Loads all prioritized guilds from the database into memory.
	 * This is only called once on startup.
	 */
	static async loadPrioritizedGuilds(): Promise<void> {
		// prettier-ignore
		const records = await kysely
			.selectFrom('ContentFilterPriority')
			.select('id')
			.execute();

		for (const { id } of records) {
			this._prioritizedGuilds.add(id);
		}

		Logger.custom("CF", `Loaded ${records.length} prioritized guilds into memory.`);
	}

	/**
	 * Enqueues an automated scan job for a newly observed message.
	 *
	 * @param message Source Discord message.
	 * @param guildConfig Guild configuration wrapper.
	 * @param serializedMessage Serialized message representation for risk scoring.
	 */
	static enqueueForScan(
		message: Message<true>,
		guildConfig: GuildConfig,
		serializedMessage: SerializedMessage
	): void {
		const config = guildConfig.parseContentFilterConfig();
		if (!config) return;

		const scoping = parseChannelScoping(config.channel_scoping);
		if (!channelInScope(message.channel, scoping)) return;
		if (this._isImmuneAuthor(message, config)) return;

		this.cacheMessage(message);

		const now = Date.now();
		const state = this.getOrInitChannelState(message.channel.id, message.guildId);
		const isPrioritizedGuild = this.isPrioritizedGuild(message.guildId);

		state.messageTimestamps.push(now);
		state.messageTimestamps = state.messageTimestamps.filter(
			ts => now - ts <= CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
		);

		const measuredMpm = state.messageTimestamps.length;
		state.ewmaMpm = this._ewma(
			state.ewmaMpm,
			measuredMpm,
			CF_CONSTANTS.HEURISTIC_EWMA_MPM_ALPHA
		);

		const computedRisk = ContentFilterUtils.computeMessageRisk(config, serializedMessage);
		const risk = isPrioritizedGuild ? Math.max(computedRisk, 0.85) : computedRisk;
		const shouldBypassDropGuards =
			isPrioritizedGuild || risk >= LOW_PRIORITY_DROP_RISK_THRESHOLD;

		if (!shouldBypassDropGuards && ContentFilter.getOpenAiRateLimitCooldownMs() > 0) {
			return;
		}

		if (!shouldBypassDropGuards && this._scheduler.size() >= LOW_PRIORITY_DROP_QUEUE_SIZE) {
			return;
		}

		if (
			!shouldBypassDropGuards &&
			this._scheduler.getQueueDepthForGuild(message.guildId) >= MAX_GUILD_QUEUE_DEPTH
		) {
			return;
		}

		const nextRunAt = isPrioritizedGuild
			? now
			: this._scheduleNextScan(now, state.scanRate, risk, measuredMpm);

		this._scheduler.enqueue({
			messageId: message.id,
			channelId: message.channel.id,
			guildId: message.guildId,
			authorId: message.author.id,
			risk,
			nextRunAt,
			enqueuedAt: now,
			attempts: 0,
			maxAttempts: MAX_RETRIES,
			source: "automated",
			force: isPrioritizedGuild,
			heuristicSignals: [],
			isRetry: false
		});
	}
	/**
	 * Enqueues a high-priority heuristic candidate for immediate sampling.
	 *
	 * @param message Source Discord message.
	 * @param config Parsed content-filter configuration.
	 * @param signals Human-readable heuristic triggers.
	 * @param risk Optional risk score override.
	 */
	static enqueueHeuristicCandidate(
		message: Message<true>,
		config: ParsedContentFilterConfig,
		signals: string[],
		risk = 0.85
	): void {
		if (!config.enabled || !config.webhook_url) return;

		const scoping = parseChannelScoping(config.channel_scoping);
		if (!channelInScope(message.channel, scoping)) return;
		if (this._isImmuneAuthor(message, config)) return;

		this.cacheMessage(message);

		const now = Date.now();
		this._scheduler.enqueue({
			messageId: message.id,
			channelId: message.channelId,
			guildId: message.guildId,
			authorId: message.author.id,
			risk: Math.max(risk, 0.6),
			nextRunAt: now,
			enqueuedAt: now,
			attempts: 0,
			maxAttempts: MAX_RETRIES,
			source: "heuristic",
			force: true,
			heuristicSignals: signals,
			isRetry: false
		});
	}

	/**
	 * Applies moderator feedback to channel-level false-positive priors.
	 *
	 * @param channelId Channel identifier.
	 * @param wasFalse Whether the moderation outcome was marked false positive.
	 */
	static async handleModeratorFeedback(channelId: Snowflake, wasFalse: boolean): Promise<void> {
		const state = this.getOrInitChannelState(channelId);

		const incA = wasFalse ? 1 : 0;
		const incB = wasFalse ? 0 : 1;
		const targetA =
			state.betaA + Math.min(CF_CONSTANTS.HEURISTIC_MAX_BETA_INCREMENT_PER_CALL, incA);
		const targetB =
			state.betaB + Math.min(CF_CONSTANTS.HEURISTIC_MAX_BETA_INCREMENT_PER_CALL, incB);

		state.betaA = Math.max(
			1,
			state.betaA * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
				targetA * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA
		);
		state.betaB = Math.max(
			1,
			state.betaB * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
				targetB * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA
		);

		const mean = this._betaMean(state);
		const prev = this._stateStore.getSmoothedFalsePositive(channelId);
		this._stateStore.setSmoothedFalsePositive(
			channelId,
			prev * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
				mean * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA
		);
	}

	/**
	 * Returns scanner diagnostics for queue/state/dead-letter inspection.
	 *
	 * @param filters Optional guild/channel filter criteria.
	 * @returns Snapshot payload used by debug surfaces.
	 */
	static getDiagnostics(filters?: { guildId?: Snowflake; channelId?: Snowflake }): {
		queue: ReturnType<ScanJobScheduler["snapshot"]>;
		states: ReturnType<StateStore["snapshots"]>;
		messageCacheSize: number;
		deadLetters: ReturnType<typeof DeadLetterStore.getSummary>;
		recentDeadLetters: ReturnType<typeof DeadLetterStore.getRecent>;
		prioritizedGuilds: Snowflake[];
	} {
		return {
			queue: this._scheduler.snapshot(),
			states: this._stateStore.snapshots(
				channelId => this._scheduler.getQueueDepthForChannel(channelId),
				filters
			),
			messageCacheSize: this._messageCache.size,
			deadLetters: DeadLetterStore.getSummary(),
			recentDeadLetters: DeadLetterStore.getRecent(10),
			prioritizedGuilds: this.getPrioritizedGuilds()
		};
	}

	/**
	 * Executes one scheduler tick and processes jobs due in the current slice.
	 */
	private static async _tick(): Promise<void> {
		const now = Date.now();
		this._pruneMessageCache();

		const availableSlots = Math.max(0, MAX_CONCURRENT_SCAN_JOBS - this._activeJobCount);
		if (availableSlots <= 0) {
			return;
		}

		const openAiCooldownMs = ContentFilter.getOpenAiRateLimitCooldownMs();
		if (openAiCooldownMs > 0 && !this._scheduler.hasDueForcedJob(now)) {
			return;
		}

		const globalRate = Math.min(
			CF_CONSTANTS.HEURISTIC_MAX_SCAN_RATE,
			Math.max(
				CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
				this._stateStore.aggregateScanRateEstimate(state =>
					this.getDynamicBaseScanRateForState(state)
				)
			)
		);

		const scansPerSecond = globalRate / 60;
		const tickDuration = CF_CONSTANTS.HEURISTIC_TICK_INTERVAL_MS;
		const allowedScans = Math.max(1, Math.floor(scansPerSecond * (tickDuration / 1000)));
		const jobBudget =
			openAiCooldownMs > 0
				? Math.min(1, availableSlots)
				: Math.min(allowedScans, availableSlots);

		const jobs = this._scheduler.pullDue(now, jobBudget);

		if (jobs.length === 0) {
			return;
		}

		const prefetchedTextResultsByJobIndex = new Map<number, Moderation[]>();
		const textBatch = jobs
			.map((job, jobIndex) => {
				const cachedMessage = this.getCachedMessage(job.messageId);
				const text = cachedMessage?.content?.trim();

				if (!text) {
					return null;
				}

				return { jobIndex, text };
			})
			.filter((item): item is { jobIndex: number; text: string } => item !== null);

		const canPrefetchText =
			openAiCooldownMs <= 0 &&
			textBatch.length >= TEXT_PREFETCH_MIN_BATCH_SIZE &&
			now >= this._textPrefetchPausedUntil;

		if (canPrefetchText) {
			try {
				const batchResults = await ContentFilter.batchScanText(
					textBatch.map(item => item.text),
					undefined,
					undefined,
					undefined,
					{ maxRetries: TEXT_PREFETCH_OPENAI_MAX_RETRIES }
				);

				for (const [resultIndex, item] of textBatch.entries()) {
					const moderationResult = batchResults[resultIndex];
					if (!moderationResult) continue;

					prefetchedTextResultsByJobIndex.set(item.jobIndex, [moderationResult]);
				}
			} catch (error) {
				const retryAfter =
					error instanceof RetryableScanError &&
					typeof error.retryAfterMs === "number"
						? Math.max(TEXT_PREFETCH_FALLBACK_PAUSE_MS, error.retryAfterMs)
						: TEXT_PREFETCH_FALLBACK_PAUSE_MS;

				this._textPrefetchPausedUntil = now + retryAfter;

				Logger.warn(
					`CF text batch prefetch failed for ${textBatch.length} jobs: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}

		for (const [jobIndex, job] of jobs.entries()) {
			this._activeJobCount++;
			void this._processJob(job, now, prefetchedTextResultsByJobIndex.get(jobIndex))
				.catch(error => {
					Logger.error("CF job processing failed unexpectedly:", error);
				})
				.finally(() => {
					this._activeJobCount = Math.max(0, this._activeJobCount - 1);
					this._scheduler.releaseJob(job);
				});
		}
	}

	/**
	 * Processes a single scan job end-to-end.
	 *
	 * @param job The job being processed.
	 * @param now Tick timestamp.
	 * @param prefetchedTextResult Optional pre-fetched moderation result for text detector.
	 */
	private static async _processJob(
		job: ScanJob,
		now: number,
		prefetchedTextResult?: Moderation[]
	): Promise<void> {
		try {
			const alertExists = await ContentFilterUtils.alertExistsForMessage(job.messageId);
			if (alertExists) return;

			const message = await this._resolveMessage(job);
			if (!message) return;

			const guildConfig = await ConfigManager.getGuildConfig(job.guildId);
			const config = guildConfig.parseContentFilterConfig();
			if (!config) return;

			const prep = await this.prepareChannelForScan(
				message.channel as TextChannel,
				message,
				config,
				now,
				{ risk: job.risk, force: job.force }
			);

			if (!prep || !prep.shouldScan) {
				return;
			}

			const predictions = await ContentFilter.runDetectors(
				message.channel,
				message,
				config,
				prep.state,
				prefetchedTextResult,
				job.force &&
					ContentFilter.getOpenAiRateLimitCooldownMs() <=
						FORCE_COOLDOWN_BYPASS_WINDOW_MS
			);

			if (job.source === "heuristic" && job.heuristicSignals.length > 0) {
				predictions.push({
					detector: null,
					content: null,
					data: job.heuristicSignals.map(signal => ({ content: signal }))
				});
			}

			if (predictions.length === 0) {
				return;
			}

			await this.applyPredictionsToState(
				prep.state,
				job.authorId,
				predictions,
				now,
				prep.riskScore,
				prep.smoothed
			);

			await ContentFilter.createContentFilterAlert(
				predictions,
				job.source === "heuristic" ? ScanTypes.Heuristic : ScanTypes.Automated,
				message,
				config
			);

			const shouldLog = this.adjustScanRate(prep.state, job.channelId, now, prep.smoothed);
			if (shouldLog && config.verbosity === "Verbose") {
				await this.sendScanRateChangeLog(
					message.channel as TextChannel,
					prep.state.scanRate,
					config
				);
			}
		} catch (error) {
			await this._handleJobFailure(job, error, now);
		}
	}

	/**
	 * Resolves a job message from cache first, then Discord API fallback.
	 *
	 * @param job The job whose message should be resolved.
	 * @returns The resolved in-guild message or null when unavailable.
	 */
	private static async _resolveMessage(job: ScanJob): Promise<Message<true> | null> {
		const cached = this.getCachedMessage(job.messageId);
		if (cached) {
			return cached;
		}

		const channel = client.channels.cache.get(job.channelId) ?? null;
		if (!channel || !channel.isTextBased() || channel.isDMBased()) {
			return null;
		}

		const fetched = await (channel as TextChannel).messages
			.fetch(job.messageId)
			.catch(() => null);
		if (!fetched || !fetched.inGuild()) {
			return null;
		}

		this.cacheMessage(fetched);
		return fetched;
	}

	/**
	 * Handles processing failures by requeueing retryable jobs or dead-lettering terminal failures.
	 *
	 * @param job Failed job context.
	 * @param error Failure value thrown during processing.
	 * @param now Tick timestamp.
	 */
	private static async _handleJobFailure(
		job: ScanJob,
		error: unknown,
		now: number
	): Promise<void> {
		const reason = error instanceof Error ? error.message : String(error ?? "unknown");
		const nextAttempt = job.attempts + 1;
		const isRetryableError =
			error instanceof RetryableScanError || this._isTransientRetryableError(error);
		const isOpenAiRateLimit = this._isOpenAiRateLimitError(error);

		if (this._shouldDropLowPriorityJob(job, error)) {
			const shouldLog = now >= this._lowPriorityDropLogWindowUntil;
			this._lowPriorityDropLogWindowUntil = now + LOW_PRIORITY_DROP_LOG_WINDOW_MS;

			if (shouldLog) {
				Logger.custom(
					"CF",
					JSON.stringify({
						event: "dropped_low_priority_cf_jobs",
						timestamp: new Date(now).toISOString(),
						queueDepth: this._scheduler.size()
					})
				);
			}

			return;
		}

		if (isOpenAiRateLimit) {
			const hintedRetryAfter =
				error instanceof RetryableScanError && typeof error.retryAfterMs === "number"
					? error.retryAfterMs
					: Math.min(
							RETRY_MAX_DELAY_MS,
							RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, job.attempts))
						);

			const minRetryAfter = job.force
				? OPENAI_RATE_LIMIT_MIN_RETRY_MS_FORCED
				: OPENAI_RATE_LIMIT_MIN_RETRY_MS;
			const retryAfter = Math.max(minRetryAfter, hintedRetryAfter);
			const jitter = Math.floor(Math.random() * Math.max(1000, retryAfter * 0.2));
			const nextRunAt = now + retryAfter + jitter;

			this._scheduler.enqueue({
				...job,
				nextRunAt,
				attempts: job.attempts,
				isRetry: true
			});

			const windowEndsAt = now + Math.max(1000, retryAfter);
			const shouldLog = now >= this._openAiRateLimitLogWindowUntil;

			this._openAiRateLimitLogWindowUntil = Math.max(
				this._openAiRateLimitLogWindowUntil,
				windowEndsAt
			);

			if (shouldLog) {
				Logger.custom(
					"CF",
					JSON.stringify({
						event: "openai_rate_limit_hit",
						timestamp: new Date(now).toISOString(),
						deferred: true,
						retryAfter,
						queueDepth: this._scheduler.size()
					})
				);
			}

			return;
		}

		if (!isRetryableError || nextAttempt >= job.maxAttempts) {
			await DeadLetterStore.record(
				job,
				isRetryableError ? "max-retries-exceeded" : "non-retryable-failure",
				error
			);
			return;
		}

		const retryAfter =
			error instanceof RetryableScanError && error.retryAfterMs
				? error.retryAfterMs
				: Math.min(
						RETRY_MAX_DELAY_MS,
						RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, job.attempts))
					);

		const jitter = Math.floor(Math.random() * Math.max(1000, retryAfter * 0.2));
		const nextRunAt = now + retryAfter + jitter;

		this._scheduler.enqueue({
			...job,
			nextRunAt,
			attempts: nextAttempt,
			isRetry: true
		});

		Logger.warn("CF scan job scheduled for retry", {
			jobId: job.jobId,
			source: job.source,
			messageId: job.messageId,
			channelId: job.channelId,
			attempts: nextAttempt,
			maxAttempts: job.maxAttempts,
			nextRunAt,
			reason
		});
	}

	/**
	 * Checks whether an error should be retried due to transient transport/runtime conditions.
	 *
	 * @param error Failure value thrown during scan processing.
	 * @returns True when the error is likely transient.
	 */
	private static _isTransientRetryableError(error: unknown): boolean {
		const status = (error as { status?: unknown })?.status;
		if (typeof status === "number") {
			if (status === 408 || status === 409 || status === 425 || status === 429) {
				return true;
			}

			if (status >= 500 && status <= 599) {
				return true;
			}
		}

		const code = (error as { code?: unknown })?.code;
		if (typeof code === "string") {
			const normalizedCode = code.toLowerCase();
			if (
				normalizedCode.includes("timeout") ||
				normalizedCode.includes("abort") ||
				normalizedCode.includes("reset") ||
				normalizedCode.includes("econn") ||
				normalizedCode.includes("eai_again") ||
				normalizedCode.includes("network")
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
			normalizedMessage.includes("aborterror") ||
			normalizedMessage.includes("timed out") ||
			normalizedMessage.includes("timeout") ||
			normalizedMessage.includes("network") ||
			normalizedMessage.includes("socket hang up") ||
			normalizedMessage.includes("temporarily unavailable")
		);
	}

	/**
	 * Determines whether a low-priority automated job should be dropped under rate-limit pressure.
	 *
	 * @param job Failed job context.
	 * @param error Failure value thrown during scan processing.
	 * @returns True when dropping the job is preferable to retrying.
	 */
	private static _shouldDropLowPriorityJob(job: ScanJob, error: unknown): boolean {
		if (!this._isOpenAiRateLimitError(error)) return false;
		if (job.source !== "automated") return false;
		if (job.force) return false;
		if (job.risk >= LOW_PRIORITY_DROP_RISK_THRESHOLD) return false;

		return this._scheduler.size() >= LOW_PRIORITY_DROP_QUEUE_SIZE;
	}

	/**
	 * Checks whether a failure originated from OpenAI rate limiting.
	 *
	 * @param error Failure value thrown during scan processing.
	 * @returns True when error indicates OpenAI moderation rate limiting.
	 */
	private static _isOpenAiRateLimitError(error: unknown): boolean {
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
			(normalizedMessage.includes("rate limit") ||
				normalizedMessage.includes("rate-limited"))
		);
	}

	/**
	 * Prunes stale entries and enforces cache-size limits for message cache.
	 */
	private static _pruneMessageCache(): void {
		const cutoff = Date.now() - MESSAGE_CACHE_MAX_AGE_MS;

		for (const [id, entry] of this._messageCache.entries()) {
			if (entry.cachedAt < cutoff) {
				this._messageCache.delete(id);
			}
		}

		if (this._messageCache.size > MESSAGE_CACHE_MAX_SIZE) {
			const entries = [...this._messageCache.entries()].sort(
				(a, b) => a[1].cachedAt - b[1].cachedAt
			);
			const toRemove = entries.slice(0, this._messageCache.size - MESSAGE_CACHE_MAX_SIZE);
			for (const [id] of toRemove) {
				this._messageCache.delete(id);
			}
		}
	}

	/**
	 * Evaluates channel/user state and determines whether a message should be scanned.
	 *
	 * @param channel Message channel context.
	 * @param message Source message.
	 * @param config Parsed content-filter configuration.
	 * @param now Evaluation timestamp.
	 * @param options Optional risk and force-scan overrides.
	 * @returns Prepared scan context, or null when scanning is disabled.
	 */
	static async prepareChannelForScan(
		channel: TextChannel,
		message: Message<true>,
		config: ParsedContentFilterConfig,
		now: number,
		options?: { risk?: number; force?: boolean }
	): Promise<{
		state: ChannelScanState;
		shouldScan: boolean;
		smoothed: number;
		riskScore: number;
	} | null> {
		if (!config.enabled || !config.webhook_url) return null;
		if (this._isImmuneAuthor(message, config)) return null;
		const isPrioritizedGuild = this.isPrioritizedGuild(message.guildId);

		const state = this.getOrInitChannelState(channel.id, channel.guildId);
		this.cleanupOldTimestamps(state, now, CF_CONSTANTS.CONTENT_FILTER_ALERT_TTL);

		let effectiveRisk = options?.risk;
		let trafficEstimate: number = CF_CONSTANTS.HEURISTIC_DEFAULT_TRAFFIC_ESTIMATE;
		let falsePositiveRatio = 0;

		try {
			const traffic = Math.max(1, Math.round(state.ewmaMpm));
			const windowMs = Math.max(
				CF_CONSTANTS.HEURISTIC_WINDOW_MIN_MS,
				Math.min(
					CF_CONSTANTS.HEURISTIC_WINDOW_MAX_MS,
					Math.round(
						CF_CONSTANTS.HEURISTIC_WINDOW_BASE_MS *
							(CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE / traffic)
					)
				)
			);
			const windowStart = new Date(now - windowMs);

			const recent = await ContentFilterUtils.getRecentAlertsAndFalsePositiveRatio(
				channel.guildId,
				channel.id,
				windowStart
			);

			falsePositiveRatio = recent.falsePositiveRatio;
			trafficEstimate = Math.max(1, Math.round(state.ewmaMpm));

			if (recent.highestScore && effectiveRisk === undefined) {
				effectiveRisk = Math.min(1, recent.highestScore / 10);
			}
		} catch {
			// Fall back to defaults when DB lookups fail.
		}

		const prevSmoothed = this._stateStore.getSmoothedFalsePositive(channel.id);
		const smoothed =
			prevSmoothed * (1 - CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA) +
			falsePositiveRatio * CF_CONSTANTS.HEURISTIC_SMOOTHED_FP_ALPHA;
		this._stateStore.setSmoothedFalsePositive(channel.id, smoothed);

		const decay = this._computeDecayFactor(state, smoothed);
		const priorityThreshold = this.computePriorityThreshold(state, smoothed);
		const userEntry = state.userScores.get(message.author.id) ?? { score: 0, lastScan: 0 };

		if (userEntry.score > 0) {
			userEntry.score = userEntry.score * decay;
			state.userScores.set(message.author.id, userEntry);
		}

		const isPriorityUser = userEntry.score >= priorityThreshold;
		const riskScore = effectiveRisk ?? 0.5;
		let shouldScan = !!options?.force || isPrioritizedGuild;

		if (!shouldScan) {
			if (isPriorityUser) {
				shouldScan = true;
			} else {
				const baseScanRate = this.getDynamicBaseScanRateForState(state);
				const samplingFactor = Math.min(
					1,
					Math.max(CF_CONSTANTS.HEURISTIC_MIN_SAMPLING_FACTOR, riskScore)
				);
				const probability = Math.min(
					1,
					(baseScanRate / Math.max(trafficEstimate, 1)) * samplingFactor
				);
				shouldScan = Math.random() < probability;
			}
		}

		if (!shouldScan && !options?.force) {
			return { state, shouldScan: false, smoothed, riskScore };
		}

		const updatedEntry = state.userScores.get(message.author.id) ?? { score: 0, lastScan: 0 };
		updatedEntry.lastScan = now;
		state.userScores.set(message.author.id, updatedEntry);
		state.scanTimestamps.push(now);

		if (isPriorityUser && config.verbosity !== "Minimal") {
			if (!state.priorityAlertedUsers.has(message.author.id)) {
				await this.sendPriorityUserWarning(message, config);
				state.priorityAlertedUsers.add(message.author.id);
			}
		} else if (!isPriorityUser) {
			state.priorityAlertedUsers.delete(message.author.id);
		}

		return { state, shouldScan: true, smoothed, riskScore };
	}

	/**
	 * Checks whether a message author has an immune role configured for CF.
	 *
	 * @param message Source message.
	 * @param config Parsed content-filter configuration.
	 * @returns True when author has any configured immune role.
	 */
	private static _isImmuneAuthor(
		message: Message<true>,
		config: ParsedContentFilterConfig
	): boolean {
		if (!config.immune_roles || config.immune_roles.length === 0) {
			return false;
		}

		return !!message.member?.roles.cache.hasAny(...config.immune_roles);
	}

	/**
	 * Sends a priority-user notification when a user crosses scan-priority thresholds.
	 *
	 * @param message Source message for user context.
	 * @param config Parsed content-filter configuration.
	 */
	static async sendPriorityUserWarning(
		message: Message<true>,
		config: ParsedContentFilterConfig
	): Promise<void> {
		if (!config.webhook_url) return;

		const embed = new EmbedBuilder()
			.setColor(Colors.NotQuiteBlack)
			.setAuthor({ name: `${ScanTypes.Heuristic} - User Prioritized` })
			.setDescription(
				`${userMentionWithId(message.author.id)} has crossed the priority threshold and will be sampled more aggressively.`
			)
			.setTimestamp();

		const webhook = new WebhookClient({ url: config.webhook_url });
		await webhook.send({ embeds: [embed] }).catch(() => null);
		webhook.destroy();
	}

	/**
	 * Sends a scan-rate change notification to the configured moderation webhook.
	 *
	 * @param channel Channel whose scan rate changed.
	 * @param newRate Newly computed scan rate.
	 * @param config Parsed content-filter configuration.
	 */
	static async sendScanRateChangeLog(
		channel: TextChannel,
		newRate: number,
		config: ParsedContentFilterConfig
	): Promise<void> {
		if (!config.webhook_url) return;

		const embed = new EmbedBuilder()
			.setColor(Colors.Orange)
			.setAuthor({ name: `${ScanTypes.Heuristic}: Scan Rate Update` })
			.setDescription(
				`Scan rate for <#${channel.id}> is now ${newRate} message${newRate === 1 ? "" : "s"} per minute.`
			)
			.setTimestamp();

		const webhook = new WebhookClient({ url: config.webhook_url });
		await webhook.send({ embeds: [embed] }).catch(() => null);
		webhook.destroy();
	}

	/**
	 * Computes dynamic base scan rate from traffic EWMA and confidence priors.
	 *
	 * @param state Channel scan state.
	 * @returns Dynamic base scan rate.
	 */
	static getDynamicBaseScanRateForState(state: ChannelScanState): number {
		const ewmaMpm = state.ewmaMpm;
		const beta = this._betaMean(state);

		const raw = Math.round(
			CF_CONSTANTS.HEURISTIC_K_TRAFFIC * ewmaMpm +
				CF_CONSTANTS.HEURISTIC_K_CONF *
					(1 - beta) *
					CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE
		);

		return Math.max(
			1,
			Math.min(
				CF_CONSTANTS.HEURISTIC_MAX_SCAN_RATE,
				raw || CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE
			)
		);
	}

	/**
	 * Computes weighted user score impact from detector output and risk.
	 *
	 * @param detectorWeight Aggregate detector weight for the event.
	 * @param severity Normalized severity signal.
	 * @param riskScore Normalized risk score.
	 * @returns Bounded dynamic score contribution.
	 */
	static computeDynamicWeight(
		detectorWeight: number,
		severity: number,
		riskScore: number
	): number {
		const weighted =
			detectorWeight *
			(CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_BASE +
				severity * CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_SEVERITY_MULT) *
			(1 + Math.min(1, riskScore));

		return Math.max(
			CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_DYNAMIC_WEIGHT_MAX, weighted)
		);
	}

	/**
	 * Applies prediction outcomes to channel/user state.
	 *
	 * @param state Channel scan state.
	 * @param authorId Author identifier for score updates.
	 * @param predictions Detector predictions for the message.
	 * @param now Current timestamp.
	 * @param riskScore Normalized risk score.
	 * @param smoothedFalsePositive Smoothed false-positive ratio.
	 */
	static async applyPredictionsToState(
		state: ChannelScanState,
		authorId: Snowflake,
		predictions: ContentPredictions[],
		now: number,
		riskScore: number,
		smoothedFalsePositive = 0
	): Promise<void> {
		state.alertCount = state.alertCount + 1;

		const timestamps = (state.flaggedUsers.get(authorId) ?? []).filter(
			ts => now - ts < CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
		);
		timestamps.push(now);
		state.flaggedUsers.set(authorId, timestamps);

		const decay = this._computeDecayFactor(state, smoothedFalsePositive);
		const userEntry = state.userScores.get(authorId) ?? { score: 0, lastScan: now };
		const detectorWeight = Math.min(3, 1 + predictions.length);
		const severity = Math.min(1, (predictions.flatMap(p => p.data).length || 1) / 3);
		const dynamicWeight = this.computeDynamicWeight(detectorWeight, severity, riskScore);

		userEntry.score = userEntry.score * decay + dynamicWeight;
		userEntry.lastScan = now;
		state.userScores.set(authorId, userEntry);
		state.falsePositiveRatio = smoothedFalsePositive;
	}

	/**
	 * Adjusts channel scan rate using PID control and adaptive thresholds.
	 *
	 * @param state Channel scan state.
	 * @param channelId Channel identifier.
	 * @param now Current timestamp.
	 * @param smoothedFalsePositive Smoothed false-positive ratio.
	 * @returns Whether the change should emit a scan-rate log.
	 */
	static adjustScanRate(
		state: ChannelScanState,
		channelId: Snowflake,
		now: number,
		smoothedFalsePositive = 0
	): boolean {
		const pid = this._pidByChannel.get(channelId) ?? {
			integral: 0,
			lastError: 0,
			lastUpdate: now
		};

		const dtMs = Math.max(0, now - state.betaLastUpdate);
		if (dtMs > 0) {
			const decayFactor = Math.exp(
				-Math.LN2 * (dtMs / Math.max(1, CF_CONSTANTS.HEURISTIC_BETA_DECAY_HALF_LIFE_MS))
			);
			state.betaA = Math.max(1, state.betaA * decayFactor);
			state.betaB = Math.max(1, state.betaB * decayFactor);
			state.betaLastUpdate = now;
		}

		const beta = this._betaMean(state);
		const ewmaMpm = Math.max(1, Math.round(state.ewmaMpm));
		const trafficScale = 1 + Math.min(2, Math.log10(1 + ewmaMpm) * 0.25);

		let kp =
			CF_CONSTANTS.HEURISTIC_PID_BASE_KP *
			(1 + (1 - Math.min(1, beta)) * 0.4) *
			trafficScale;
		kp = Math.max(
			CF_CONSTANTS.HEURISTIC_PID_KP_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_PID_KP_MAX, kp)
		);

		let ki = CF_CONSTANTS.HEURISTIC_PID_BASE_KI / Math.max(1, Math.log10(1 + ewmaMpm) * 0.5);
		ki = Math.max(
			CF_CONSTANTS.HEURISTIC_PID_KI_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_PID_KI_MAX, ki)
		);

		let kd =
			CF_CONSTANTS.HEURISTIC_PID_BASE_KD *
			(1 + Math.min(1, Math.log10(1 + ewmaMpm) * 0.1));
		kd = Math.max(
			CF_CONSTANTS.HEURISTIC_PID_KD_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_PID_KD_MAX, kd)
		);

		const maxStep = Math.max(
			1,
			Math.round(
				CF_CONSTANTS.HEURISTIC_RATE_INCREASE_STEP *
					(1 + (1 - Math.min(1, smoothedFalsePositive)))
			)
		);

		const baseRate = this.getDynamicBaseScanRateForState(state);
		const minRate = Math.max(CF_CONSTANTS.HEURISTIC_MIN_SCAN_RATE, baseRate);
		const adaptiveThreshold = this._estimateAdaptiveThreshold(state.scanTimestamps, now);
		const error = state.alertCount - adaptiveThreshold;

		const dt = Math.max(1, (now - pid.lastUpdate) / 1000);
		pid.integral += error * dt;
		const derivative = (error - pid.lastError) / dt;
		const output = kp * error + ki * pid.integral + kd * derivative;

		let step = Math.max(-maxStep, Math.min(maxStep, Math.round(output)));
		if (step === 0 && error !== 0) {
			step = error > 0 ? 1 : -1;
		}

		const previousRate = state.scanRate;
		state.scanRate = Math.max(
			minRate,
			Math.min(CF_CONSTANTS.HEURISTIC_MAX_SCAN_RATE, state.scanRate + step)
		);

		if (state.scanRate > previousRate) {
			state.lastRateIncrease = now;
		}

		let changed = false;
		if (state.scanRate !== previousRate) {
			state.alertCount = 0;
			changed = true;
		}

		pid.lastError = error;
		pid.lastUpdate = now;
		this._pidByChannel.set(channelId, pid);

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
		const loggedEwmaPrev = state.loggedRateEwma;
		const absChange = Math.abs(newRate - loggedEwmaPrev);
		const significant = absChange >= CF_CONSTANTS.HEURISTIC_MIN_ABS_CHANGE_FOR_LOG;

		let shouldLog = false;
		if (changed && significant) {
			if (state.lastRateLog === 0) {
				state.lastRateLog = now;
			} else if (now - state.lastRateLog > CF_CONSTANTS.HEURISTIC_RATE_CHANGE_INTERVAL) {
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
	 * Prunes stale per-channel timestamps and user score entries.
	 *
	 * @param state Channel scan state.
	 * @param now Current timestamp.
	 * @param ttl Time-to-live for inactive user score entries.
	 */
	static cleanupOldTimestamps(state: ChannelScanState, now: number, ttl: number): void {
		state.scanTimestamps = state.scanTimestamps.filter(
			ts => now - ts < CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
		);

		for (const [userId, timestamps] of state.flaggedUsers.entries()) {
			const pruned = timestamps.filter(
				ts => now - ts < CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
			);
			if (pruned.length > 0) {
				state.flaggedUsers.set(userId, pruned);
			} else {
				state.flaggedUsers.delete(userId);
			}
		}

		for (const [userId, entry] of state.userScores.entries()) {
			const staleBySmallScore =
				entry.score <= CF_CONSTANTS.HEURISTIC_SCORE_PRUNE_EPSILON &&
				now - entry.lastScan > CF_CONSTANTS.HEURISTIC_SCAN_WINDOW;
			const staleByTTL = now - entry.lastScan > ttl;

			if (staleBySmallScore || staleByTTL) {
				state.userScores.delete(userId);
			}
		}

		if (state.userScores.size > CF_CONSTANTS.HEURISTIC_USER_SCORES_MAX_SIZE) {
			const candidates = [...state.userScores.entries()]
				.map(([userId, entry]) => [userId, entry.lastScan] as const)
				.sort((a, b) => a[1] - b[1]);

			const target = Math.floor(CF_CONSTANTS.HEURISTIC_USER_SCORES_MAX_SIZE * 0.9);
			let index = 0;
			while (state.userScores.size > target && index < candidates.length) {
				state.userScores.delete(candidates[index][0]);
				index++;
			}
		}
	}

	/**
	 * Computes the next run timestamp for a scan job.
	 *
	 * @param now Current timestamp.
	 * @param scanRate Channel scan rate.
	 * @param risk Risk score used for interval scaling.
	 * @param observedTraffic Optional observed traffic override.
	 * @returns Next scheduled run timestamp.
	 */
	private static _scheduleNextScan(
		now: number,
		scanRate: number,
		risk: number,
		observedTraffic?: number
	): number {
		const effectiveRate = Math.min(scanRate, observedTraffic ?? scanRate);
		const msgsPerMinute = Math.max(
			CF_CONSTANTS.HEURISTIC_MIN_SCAN_RATE,
			Math.round(effectiveRate)
		);
		const baseInterval = CF_CONSTANTS.HEURISTIC_SCAN_WINDOW / msgsPerMinute;

		const riskClamped = Math.max(0, Math.min(1, risk));
		const multiplier =
			CF_CONSTANTS.HEURISTIC_RISK_MULTIPLIER_MIN +
			(1 - riskClamped) *
				(CF_CONSTANTS.HEURISTIC_RISK_MULTIPLIER_MAX -
					CF_CONSTANTS.HEURISTIC_RISK_MULTIPLIER_MIN);

		const jitterMax = Math.min(
			1000,
			Math.floor(baseInterval * CF_CONSTANTS.HEURISTIC_JITTER_PCT)
		);
		const jitter = Math.floor(Math.random() * Math.max(0, jitterMax));

		return (
			now +
			Math.max(
				CF_CONSTANTS.HEURISTIC_MIN_SCHEDULE_DELAY,
				Math.floor(baseInterval * multiplier)
			) +
			jitter
		);
	}

	/**
	 * Computes an exponentially weighted moving average.
	 *
	 * @param prev Previous EWMA value.
	 * @param value New observed value.
	 * @param alpha Smoothing factor.
	 * @returns Updated EWMA value.
	 */
	private static _ewma(
		prev: number,
		value: number,
		alpha: number = CF_CONSTANTS.HEURISTIC_EWMA_ALPHA
	): number {
		return prev * (1 - alpha) + value * alpha;
	}

	/**
	 * Returns bounded beta distribution mean from channel state.
	 *
	 * @param state Channel scan state.
	 * @returns Clamped beta mean.
	 */
	private static _betaMean(state: ChannelScanState): number {
		const mean = state.betaA / (state.betaA + state.betaB);
		return Math.max(
			CF_CONSTANTS.HEURISTIC_BETA_MEAN_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_BETA_MEAN_MAX, mean)
		);
	}

	/**
	 * Computes score decay factor from false-positive priors and alert activity.
	 *
	 * @param state Channel scan state.
	 * @param smoothedFalsePositive Smoothed false-positive ratio.
	 * @returns Clamped decay factor.
	 */
	private static _computeDecayFactor(
		state: ChannelScanState,
		smoothedFalsePositive: number
	): number {
		const base = CF_CONSTANTS.HEURISTIC_DECAY_BASE;
		const fpInfluence = Math.min(
			CF_CONSTANTS.HEURISTIC_DECAY_FP_INFLUENCE_MAX,
			smoothedFalsePositive * CF_CONSTANTS.HEURISTIC_DECAY_FP_INFLUENCE_FACTOR
		);
		const alertInfluence = Math.min(
			CF_CONSTANTS.HEURISTIC_DECAY_ALERT_INFLUENCE_MAX,
			state.alertCount * CF_CONSTANTS.HEURISTIC_DECAY_ALERT_INFLUENCE_PER_ALERT
		);

		return Math.max(
			CF_CONSTANTS.HEURISTIC_DECAY_MIN,
			Math.min(CF_CONSTANTS.HEURISTIC_DECAY_MAX, base - fpInfluence - alertInfluence)
		);
	}

	/**
	 * Computes priority-user threshold for aggressive sampling.
	 *
	 * @param state Channel scan state.
	 * @param smoothedFalsePositive Smoothed false-positive ratio.
	 * @returns Priority threshold score.
	 */
	static computePriorityThreshold(
		state: ChannelScanState,
		smoothedFalsePositive: number
	): number {
		const base = CF_CONSTANTS.HEURISTIC_PRIORITY_USER_FLAG_THRESHOLD || 2;
		const multiplier =
			1 +
			Math.min(
				CF_CONSTANTS.HEURISTIC_PRIORITY_MULT_MAX,
				smoothedFalsePositive * CF_CONSTANTS.HEURISTIC_PRIORITY_MULT_FACTOR
			);

		const recentAlerts = state.scanTimestamps.length;
		const recentInfluence = Math.max(
			0,
			1 - Math.min(0.5, recentAlerts / CF_CONSTANTS.HEURISTIC_RECENT_ALERTS_CAP)
		);

		return Math.max(1, Math.ceil(base * multiplier * recentInfluence));
	}

	/**
	 * Estimates adaptive alert threshold using weighted historic windows.
	 *
	 * @param timestamps Scan timestamps for the channel.
	 * @param now Current timestamp.
	 * @returns Estimated threshold based on weighted p95 heuristic.
	 */
	private static _estimateAdaptiveThreshold(timestamps: number[], now: number): number {
		if (timestamps.length === 0) return 1;

		const alpha = Math.max(0, Math.min(1, CF_CONSTANTS.HEURISTIC_ADAPTIVE_DECAY_ALPHA));
		const histogram = new Map<number, number>();
		let totalWeight = 0;

		for (let i = 0; i < CF_CONSTANTS.HEURISTIC_ADAPTIVE_P95_WINDOWS; i++) {
			const start = now - (i + 1) * CF_CONSTANTS.HEURISTIC_SCAN_WINDOW;
			const end = now - i * CF_CONSTANTS.HEURISTIC_SCAN_WINDOW;
			const count = timestamps.filter(ts => ts > start && ts <= end).length;
			const weight = Math.pow(alpha, i);

			histogram.set(count, (histogram.get(count) || 0) + weight);
			totalWeight += weight;
		}

		const entries = [...histogram.entries()].sort((a, b) => a[0] - b[0]);
		const target = totalWeight * 0.95;

		let cumulative = 0;
		let p95 = 0;
		for (const [count, weight] of entries) {
			cumulative += weight;
			p95 = count;
			if (cumulative >= target) break;
		}

		return Math.max(1, Math.ceil(p95 + 1));
	}
}
