import type { Snowflake } from "discord.js";

import { CF_CONSTANTS } from "#utils/Constants.js";

import type { ChannelScanState, ChannelStateSnapshot } from "./Types.js";

const MAX_CHANNEL_STATES = 150;
const CHANNEL_STATE_TTL_MS = 60 * 60 * 1000;

/**
 * Stores per-channel scanning state and lightweight aggregate metadata.
 */
export default class StateStore {
	private _states = new Map<Snowflake, ChannelScanState>();
	private _activity = new Map<Snowflake, number>();
	private _smoothedFalsePositive = new Map<Snowflake, number>();

	/**
	 * Retrieves an existing channel state or initializes a new one.
	 *
	 * @param channelId The channel whose state should be retrieved.
	 * @param guildId Optional guild identifier used when creating/updating state.
	 * @returns The channel scan state.
	 */
	getOrInit(channelId: Snowflake, guildId?: Snowflake): ChannelScanState {
		const now = Date.now();
		this._activity.set(channelId, now);

		const existing = this._states.get(channelId);
		if (existing) {
			existing.lastActivity = now;
			if (guildId) existing.guildId = guildId;
			return existing;
		}

		const state: ChannelScanState = {
			guildId: guildId ?? null,
			scanTimestamps: [],
			alertCount: 0,
			scanRate: CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
			falsePositiveRatio: 0,
			lastRateLog: 0,
			ewmaMpm: CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
			loggedRateEwma: CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
			messageTimestamps: [],
			betaLastUpdate: now,
			betaA: 1,
			betaB: 1,
			flaggedUsers: new Map(),
			lastRateIncrease: 0,
			priorityAlertedUsers: new Set(),
			userScores: new Map(),
			lastActivity: now
		};

		this._states.set(channelId, state);
		this._enforceCapacity();

		return state;
	}

	/**
	 * Gets a channel state if present and refreshes last-activity tracking.
	 *
	 * @param channelId The channel whose state should be read.
	 * @returns The channel state or null when no state exists.
	 */
	get(channelId: Snowflake): ChannelScanState | null {
		const state = this._states.get(channelId) ?? null;
		if (state) {
			state.lastActivity = Date.now();
			this._activity.set(channelId, state.lastActivity);
		}

		return state;
	}

	/**
	 * Reads the smoothed false-positive ratio for a channel.
	 *
	 * @param channelId The channel identifier.
	 * @returns The smoothed false-positive ratio, defaulting to zero.
	 */
	getSmoothedFalsePositive(channelId: Snowflake): number {
		return this._smoothedFalsePositive.get(channelId) ?? 0;
	}

	/**
	 * Stores the latest smoothed false-positive ratio for a channel.
	 *
	 * @param channelId The channel identifier.
	 * @param value The new smoothed false-positive ratio.
	 */
	setSmoothedFalsePositive(channelId: Snowflake, value: number): void {
		this._smoothedFalsePositive.set(channelId, value);
	}

	/**
	 * Prunes stale channel state entries and enforces configured capacity.
	 *
	 * @param now Optional reference time used for deterministic pruning.
	 */
	prune(now = Date.now()): void {
		const cutoff = now - CHANNEL_STATE_TTL_MS;

		for (const [channelId, lastActivity] of this._activity.entries()) {
			if (lastActivity < cutoff) {
				this._states.delete(channelId);
				this._activity.delete(channelId);
				this._smoothedFalsePositive.delete(channelId);
			}
		}

		this._enforceCapacity();
	}

	/**
	 * Computes an averaged scan-rate estimate across tracked channels.
	 *
	 * @param rateResolver Function that resolves a per-channel effective scan rate.
	 * @returns The averaged rate, bounded to at least the configured base rate.
	 */
	aggregateScanRateEstimate(rateResolver: (state: ChannelScanState) => number): number {
		if (this._states.size === 0) {
			return CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE;
		}

		let total = 0;
		let count = 0;
		for (const state of this._states.values()) {
			total += rateResolver(state);
			count++;
		}

		return Math.max(
			CF_CONSTANTS.HEURISTIC_BASE_SCAN_RATE,
			Math.round(total / Math.max(1, count))
		);
	}

	/**
	 * Generates channel snapshots for diagnostics output.
	 *
	 * @param queueDepthForChannel Function used to resolve queue depth per channel.
	 * @param filters Optional guild/channel filters for the snapshot output.
	 * @returns Channel snapshots sorted by latest activity.
	 */
	snapshots(
		queueDepthForChannel: (channelId: Snowflake) => number,
		filters?: { guildId?: Snowflake; channelId?: Snowflake }
	): ChannelStateSnapshot[] {
		const now = Date.now();
		const snapshots: ChannelStateSnapshot[] = [];

		for (const [channelId, state] of this._states.entries()) {
			if (filters?.channelId && filters.channelId !== channelId) continue;
			if (filters?.guildId && state.guildId !== filters.guildId) continue;

			const pendingScansInWindow = state.scanTimestamps.filter(
				ts => now - ts <= CF_CONSTANTS.HEURISTIC_SCAN_WINDOW
			).length;

			snapshots.push({
				channelId,
				guildId: state.guildId,
				queueDepth: queueDepthForChannel(channelId),
				scanRate: state.scanRate,
				ewmaMpm: state.ewmaMpm,
				falsePositiveRatio: state.falsePositiveRatio,
				priorityUsers: state.priorityAlertedUsers.size,
				trackedUsers: state.userScores.size,
				flaggedUsers: state.flaggedUsers.size,
				lastActivity: state.lastActivity,
				pendingScansInWindow
			});
		}

		return snapshots.sort((a, b) => b.lastActivity - a.lastActivity);
	}

	/**
	 * Returns the number of channels currently tracked in state.
	 *
	 * @returns The number of active state entries.
	 */
	count(): number {
		return this._states.size;
	}

	/**
	 * Enforces the maximum number of tracked channels by evicting least-recently-active entries.
	 */
	private _enforceCapacity(): void {
		if (this._states.size <= MAX_CHANNEL_STATES) return;

		const byLeastRecent = [...this._activity.entries()].sort((a, b) => a[1] - b[1]);
		const excess = this._states.size - MAX_CHANNEL_STATES;

		for (let i = 0; i < excess; i++) {
			const channelId = byLeastRecent[i]?.[0];
			if (!channelId) break;

			this._states.delete(channelId);
			this._activity.delete(channelId);
			this._smoothedFalsePositive.delete(channelId);
		}
	}
}
