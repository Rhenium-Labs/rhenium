import type { Snowflake } from "discord.js";
import type { ChannelScanState } from "#cf/Types.js";

import { prisma } from "#root/index.js";
import { CF_CONSTANTS } from "./Constants.js";
import { ContentFilterAlert, DetectorMode, ContentFilterConfig, Message, ContentFilterStatus } from "#prisma/client.js";

export default class ContentFilterUtils {
	/**
	 * Computes the risk score for a message based on its properties.
	 *
	 * @param config The content filter configuration.
	 * @param message The serialized message data.
	 * @returns The computed risk score.
	 */
	public static computeMessageRisk(config: ContentFilterConfig, message: Message): number {
		const riskIncreaseStep =
			config.detector_mode === DetectorMode.Lenient
				? CF_CONSTANTS.HEURISTIC_LENIENT_RISK_INCREASE
				: config.detector_mode === DetectorMode.Medium
					? CF_CONSTANTS.HEURISTIC_MEDIUM_RISK_INCREASE
					: CF_CONSTANTS.HEURISTIC_STRICT_RISK_INCREASE;

		let risk = CF_CONSTANTS.HEURISTIC_BASE_RISK;

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
			maxRetries = CF_CONSTANTS.DEFAULT_MAX_RETRIES,
			initialDelay = CF_CONSTANTS.DEFAULT_INITIAL_DELAY,
			backoffFactor = CF_CONSTANTS.DEFAULT_BACKOFF_FACTOR,
			maxDelay = CF_CONSTANTS.DEFAULT_MAX_DELAY,
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
					sleep = Math.floor(delay * (1 + Math.random() * CF_CONSTANTS.DEFAULT_RETRY_JITTER));
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
				? CF_CONSTANTS.HEURISTIC_LENIENT_SCORE
				: config.detector_mode === DetectorMode.Medium
					? CF_CONSTANTS.HEURISTIC_MEDIUM_SCORE
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
			base += smoothedFP * CF_CONSTANTS.HEURISTIC_SCORE_FP_INFLUENCE;

			const now = Date.now();
			const userAlerts: number[] = state.flaggedUsers?.get(authorId) ?? [];
			const recentAlerts = userAlerts.filter(
				(ts: number) => now - ts <= CF_CONSTANTS.HEURISTIC_USER_RECENT_ALERT_WINDOW_MS
			).length;
			const recentNormalized = Math.min(1, recentAlerts / 5);
			base -= recentNormalized * CF_CONSTANTS.HEURISTIC_SCORE_USER_ALERT_INFLUENCE;
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
				mod_status: "Pending",
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
		const falseCount = alerts.filter(a => a.mod_status === "False").length;
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
	public static async deleteOldAlerts(ttl: number = CF_CONSTANTS.CONTENT_FILTER_ALERT_TTL): Promise<number> {
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
	public static async deleteOldContentLogs(ttl: number = CF_CONSTANTS.CONTENT_FILTER_LOG_TTL): Promise<number> {
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
