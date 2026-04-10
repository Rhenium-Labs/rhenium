import { randomUUID } from "node:crypto";

import { kv } from "#root/index.js";

import type { DeadLetterEntry, ScanJob } from "./Types.js";

import Logger from "#utils/Logger.js";

const DEAD_LETTER_PREFIX = "cf:dlq";
const MAX_RECENT_ENTRIES = 200;

/**
 * In-memory and KV-backed dead-letter tracking for failed scan jobs.
 */
export default class DeadLetterStore {
	private static _recent: DeadLetterEntry[] = [];
	private static _recordedTotal = 0;

	/**
	 * Records a failed job in memory and attempts to persist it in KV storage.
	 *
	 * @param job The scan job that failed permanently.
	 * @param reason A high-level reason describing why the job was dead-lettered.
	 * @param error Optional raw error metadata to serialize for diagnostics.
	 * @returns A promise that resolves when recording and logging complete.
	 */
	static async record(job: ScanJob, reason: string, error?: unknown): Promise<void> {
		const now = Date.now();
		const entry: DeadLetterEntry = {
			id: randomUUID(),
			createdAt: now,
			reason,
			job: {
				jobId: job.jobId,
				source: job.source,
				guildId: job.guildId,
				channelId: job.channelId,
				messageId: job.messageId,
				authorId: job.authorId,
				attempts: job.attempts,
				maxAttempts: job.maxAttempts,
				risk: job.risk
			},
			error: serializeError(error)
		};

		this._recordedTotal++;
		this._recent.unshift(entry);
		if (this._recent.length > MAX_RECENT_ENTRIES) {
			this._recent.length = MAX_RECENT_ENTRIES;
		}

		try {
			await kv.put(`${DEAD_LETTER_PREFIX}:${entry.createdAt}:${entry.id}`, entry);
		} catch (kvError) {
			Logger.error("CF dead-letter KV persistence failed:", kvError);
		}

		Logger.error("CF job moved to dead-letter queue:", {
			reason,
			jobId: job.jobId,
			source: job.source,
			guildId: job.guildId,
			channelId: job.channelId,
			messageId: job.messageId,
			attempts: job.attempts,
			maxAttempts: job.maxAttempts,
			error: entry.error ?? "unknown"
		});
	}

	/**
	 * Returns the most recent dead-letter entries held in memory.
	 *
	 * @param limit Maximum number of entries to return.
	 * @returns The newest entries first.
	 */
	static getRecent(limit = 20): DeadLetterEntry[] {
		return this._recent.slice(0, Math.max(1, limit));
	}

	/**
	 * Returns aggregate dead-letter counters for diagnostics output.
	 *
	 * @returns The total recorded count and current in-memory buffer size.
	 */
	static getSummary(): { totalRecorded: number; buffered: number } {
		return {
			totalRecorded: this._recordedTotal,
			buffered: this._recent.length
		};
	}
}

/**
 * Converts unknown error input into a bounded, log-safe string.
 *
 * @param error Any value thrown by detector/runtime code.
 * @returns A serialized error string, or undefined when no error is available.
 */
function serializeError(error: unknown): string | undefined {
	if (!error) return undefined;

	if (error instanceof Error) {
		if (error.stack) return error.stack.slice(0, 4000);
		return error.message;
	}

	if (typeof error === "string") {
		return error;
	}

	try {
		return JSON.stringify(error).slice(0, 4000);
	} catch {
		return String(error);
	}
}
