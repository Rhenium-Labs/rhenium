import { randomUUID } from "node:crypto";

import type { QueueSnapshot, ScanJob } from "./Types.js";

type QueueType = "new" | "retry";

type EnqueueJob = Omit<ScanJob, "jobId" | "dedupeKey">;

const MAX_ACTIVE_JOBS = 12_000;
const MAX_JOB_AGE_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const COMPACT_RATIO = 2.25;

/**
 * Priority scheduler for content-filter scan jobs with deduplication and retry fairness.
 */
export default class ScanJobScheduler {
	private _newHeap = new BinaryHeap<ScanJob>(compareScanJobs);
	private _retryHeap = new BinaryHeap<ScanJob>(compareScanJobs);

	private _newJobs = new Map<string, ScanJob>();
	private _retryJobs = new Map<string, ScanJob>();
	private _keyQueue = new Map<string, QueueType>();
	private _guildDepth = new Map<string, number>();

	private _lastCleanupAt = 0;
	private _retryTurn = false;
	private _pool = new ScanJobPool();

	/**
	 * Enqueues a scan job, replacing weaker duplicates for the same dedupe key.
	 *
	 * @param job The job payload to enqueue.
	 * @returns The enqueued job (or the stronger existing job when retained).
	 */
	enqueue(job: EnqueueJob): ScanJob {
		const dedupeKey = `${job.guildId}:${job.channelId}:${job.messageId}:${job.source}`;
		const fullJob = this._pool.acquire(job, randomUUID(), dedupeKey);

		const targetQueue: QueueType = fullJob.isRetry ? "retry" : "new";
		const targetMap = this._mapFor(targetQueue);
		const targetHeap = this._heapFor(targetQueue);

		const existingQueue = this._keyQueue.get(dedupeKey);
		const existingMap = existingQueue ? this._mapFor(existingQueue) : null;
		const existing = existingMap?.get(dedupeKey);
		const hasExistingEntry = Boolean(existing);

		if (existingQueue) {
			if (existing) {
				const shouldKeepExisting =
					existing.nextRunAt <= fullJob.nextRunAt &&
					existing.attempts >= fullJob.attempts &&
					existing.risk >= fullJob.risk;

				if (shouldKeepExisting) {
					this._pool.release(fullJob); // newly acquired job not needed
					return existing;
				}

				this._pool.release(existing); // replaced by the stronger incoming job
			}

			existingMap?.delete(dedupeKey);
			this._keyQueue.delete(dedupeKey);
		}

		targetMap.set(dedupeKey, fullJob);
		targetHeap.push(fullJob);
		this._keyQueue.set(dedupeKey, targetQueue);

		if (!hasExistingEntry) {
			this._incrementGuildDepth(fullJob.guildId);
		}

		this._trimIfNeeded();
		this._compactIfNeeded();

		return fullJob;
	}

	/**
	 * Pulls due jobs while balancing new and retry queues.
	 *
	 * @param now Current timestamp in milliseconds.
	 * @param maxJobs Maximum number of jobs to return.
	 * @returns A list of due jobs ordered by scheduler policy.
	 */
	pullDue(now: number, maxJobs: number): ScanJob[] {
		this._cleanupStale(now);

		const jobs: ScanJob[] = [];

		while (jobs.length < maxJobs) {
			const hasDueNew = this._peekDue("new", now) !== null;
			const hasDueRetry = this._peekDue("retry", now) !== null;

			if (!hasDueNew && !hasDueRetry) {
				break;
			}

			let preferred: QueueType;
			if (hasDueNew && hasDueRetry) {
				preferred = this._retryTurn ? "retry" : "new";
				this._retryTurn = !this._retryTurn;
			} else {
				preferred = hasDueNew ? "new" : "retry";
			}

			const popped =
				this._popDue(preferred, now) ?? this._popDue(otherQueue(preferred), now);
			if (!popped) {
				break;
			}

			jobs.push(popped);
		}

		return jobs;
	}

	/**
	 * Returns the total number of active jobs across all queues.
	 *
	 * @returns Aggregate queue size.
	 */
	size(): number {
		return this._newJobs.size + this._retryJobs.size;
	}

	/**
	 * Returns queued job count for a specific channel.
	 *
	 * @param channelId The channel identifier.
	 * @returns Number of jobs currently queued for the channel.
	 */
	getQueueDepthForChannel(channelId: string): number {
		let total = 0;

		for (const job of this._newJobs.values()) {
			if (job.channelId === channelId) total++;
		}

		for (const job of this._retryJobs.values()) {
			if (job.channelId === channelId) total++;
		}

		return total;
	}

	/**
	 * Returns queued job count for a specific guild.
	 *
	 * @param guildId The guild identifier.
	 * @returns Number of jobs currently queued for the guild.
	 */
	getQueueDepthForGuild(guildId: string): number {
		return this._guildDepth.get(guildId) ?? 0;
	}

	/**
	 * Returns whether any forced/prioritized job is currently due.
	 *
	 * @param now Current timestamp in milliseconds.
	 * @returns True when at least one forced job can be popped immediately.
	 */
	hasDueForcedJob(now: number): boolean {
		for (const job of this._newJobs.values()) {
			if (job.force && job.nextRunAt <= now) return true;
		}

		for (const job of this._retryJobs.values()) {
			if (job.force && job.nextRunAt <= now) return true;
		}

		return false;
	}

	releaseJob(job: ScanJob): void {
		this._pool.release(job);
	}

	/**
	 * Produces a queue snapshot for diagnostics output.
	 *
	 * @returns Queue counts and oldest/next scheduling timestamps.
	 */
	snapshot(): QueueSnapshot {
		const jobs = [...this._newJobs.values(), ...this._retryJobs.values()];
		const oldestEnqueuedAt = jobs.length
			? jobs.reduce((acc, job) => Math.min(acc, job.enqueuedAt), Number.POSITIVE_INFINITY)
			: null;
		const nextScheduledAt = jobs.length
			? jobs.reduce((acc, job) => Math.min(acc, job.nextRunAt), Number.POSITIVE_INFINITY)
			: null;

		return {
			total: jobs.length,
			newJobs: this._newJobs.size,
			retryJobs: this._retryJobs.size,
			oldestEnqueuedAt: Number.isFinite(oldestEnqueuedAt ?? NaN) ? oldestEnqueuedAt : null,
			nextScheduledAt: Number.isFinite(nextScheduledAt ?? NaN) ? nextScheduledAt : null
		};
	}

	/**
	 * Returns the top due job in a queue without removing it.
	 *
	 * @param queueType Queue to inspect.
	 * @param now Current timestamp in milliseconds.
	 * @returns The due job at the head of the queue, or null.
	 */
	private _peekDue(queueType: QueueType, now: number): ScanJob | null {
		const heap = this._heapFor(queueType);
		const map = this._mapFor(queueType);

		while (heap.size() > 0) {
			const top = heap.peek();
			if (!top) return null;

			const current = map.get(top.dedupeKey);
			if (!current || current.jobId !== top.jobId) {
				heap.pop();
				continue;
			}

			if (top.nextRunAt > now) {
				return null;
			}

			return top;
		}

		return null;
	}

	/**
	 * Pops the next due job from a queue.
	 *
	 * @param queueType Queue to pop from.
	 * @param now Current timestamp in milliseconds.
	 * @returns The popped due job, or null when nothing is due.
	 */
	private _popDue(queueType: QueueType, now: number): ScanJob | null {
		const heap = this._heapFor(queueType);
		const map = this._mapFor(queueType);

		while (heap.size() > 0) {
			const top = heap.peek();
			if (!top) return null;

			if (top.nextRunAt > now) {
				return null;
			}

			const popped = heap.pop();
			if (!popped) return null;

			const current = map.get(popped.dedupeKey);
			if (!current || current.jobId !== popped.jobId) {
				continue;
			}

			map.delete(popped.dedupeKey);
			this._keyQueue.delete(popped.dedupeKey);
			this._decrementGuildDepth(popped.guildId);
			return popped;
		}

		return null;
	}

	/**
	 * Removes stale jobs that exceeded maximum queue age.
	 *
	 * @param now Current timestamp in milliseconds.
	 */
	private _cleanupStale(now: number): void {
		if (now - this._lastCleanupAt < CLEANUP_INTERVAL_MS) {
			return;
		}

		this._lastCleanupAt = now;
		const cutoff = now - MAX_JOB_AGE_MS;

		for (const [key, job] of this._newJobs.entries()) {
			if (job.enqueuedAt < cutoff) {
				this._newJobs.delete(key);
				this._keyQueue.delete(key);
				this._decrementGuildDepth(job.guildId);
				this._pool.release(job);
			}
		}

		for (const [key, job] of this._retryJobs.entries()) {
			if (job.enqueuedAt < cutoff) {
				this._retryJobs.delete(key);
				this._keyQueue.delete(key);
				this._decrementGuildDepth(job.guildId);
				this._pool.release(job);
			}
		}

		this._compactIfNeeded();
	}

	/**
	 * Evicts worst jobs when queue size exceeds the configured cap.
	 */
	private _trimIfNeeded(): void {
		while (this.size() > MAX_ACTIVE_JOBS) {
			const queue = this._retryJobs.size > this._newJobs.size ? "retry" : "new";
			this._evictWorst(queue);
		}
	}

	/**
	 * Evicts the least valuable job from a specific queue.
	 *
	 * @param queueType Queue to evict from.
	 */
	private _evictWorst(queueType: QueueType): void {
		const map = this._mapFor(queueType);
		if (map.size === 0) return;

		let worst: ScanJob | null = null;
		for (const job of map.values()) {
			if (!worst) {
				worst = job;
				continue;
			}

			const isWorse =
				job.nextRunAt > worst.nextRunAt ||
				(job.nextRunAt === worst.nextRunAt && job.risk < worst.risk);

			if (isWorse) {
				worst = job;
			}
		}

		if (!worst) return;

		map.delete(worst.dedupeKey);
		this._keyQueue.delete(worst.dedupeKey);
		this._decrementGuildDepth(worst.guildId);
		this._pool.release(worst);
	}

	/**
	 * Increments queued depth for a guild.
	 *
	 * @param guildId Guild identifier.
	 */
	private _incrementGuildDepth(guildId: string): void {
		this._guildDepth.set(guildId, (this._guildDepth.get(guildId) ?? 0) + 1);
	}

	/**
	 * Decrements queued depth for a guild.
	 *
	 * @param guildId Guild identifier.
	 */
	private _decrementGuildDepth(guildId: string): void {
		const current = this._guildDepth.get(guildId) ?? 0;
		if (current <= 1) {
			this._guildDepth.delete(guildId);
			return;
		}

		this._guildDepth.set(guildId, current - 1);
	}

	/**
	 * Rebuilds backing heaps when stale heap entries accumulate.
	 */
	private _compactIfNeeded(): void {
		if (this._newHeap.size() > this._newJobs.size * COMPACT_RATIO + 64) {
			this._newHeap = new BinaryHeap(compareScanJobs, this._newJobs.values());
		}

		if (this._retryHeap.size() > this._retryJobs.size * COMPACT_RATIO + 64) {
			this._retryHeap = new BinaryHeap(compareScanJobs, this._retryJobs.values());
		}
	}

	/**
	 * Resolves the map for the specified queue.
	 *
	 * @param queue Queue identifier.
	 * @returns The queue-backed map.
	 */
	private _mapFor(queue: QueueType): Map<string, ScanJob> {
		return queue === "new" ? this._newJobs : this._retryJobs;
	}

	/**
	 * Resolves the heap for the specified queue.
	 *
	 * @param queue Queue identifier.
	 * @returns The queue-backed heap.
	 */
	private _heapFor(queue: QueueType): BinaryHeap<ScanJob> {
		return queue === "new" ? this._newHeap : this._retryHeap;
	}
}

class ScanJobPool {
	private readonly _available: ScanJob[] = [];
	private static readonly MAX_SIZE = 200;

	acquire(source: EnqueueJob, jobId: string, dedupeKey: string): ScanJob {
		const job = this._available.pop() ?? ScanJobPool._makeBlank();

		job.jobId = jobId;
		job.dedupeKey = dedupeKey;
		job.messageId = source.messageId;
		job.channelId = source.channelId;
		job.guildId = source.guildId;
		job.authorId = source.authorId;
		job.risk = source.risk;
		job.nextRunAt = source.nextRunAt;
		job.enqueuedAt = source.enqueuedAt;
		job.attempts = source.attempts;
		job.maxAttempts = source.maxAttempts;
		job.source = source.source;
		job.force = source.force;
		job.isRetry = source.isRetry;

		job.heuristicSignals.length = 0;
		for (const signal of source.heuristicSignals) {
			job.heuristicSignals.push(signal);
		}

		return job;
	}

	release(job: ScanJob): void {
		if (this._available.length < ScanJobPool.MAX_SIZE) {
			this._available.push(job);
		}
	}

	private static _makeBlank(): ScanJob {
		return {
			jobId: "",
			dedupeKey: "",
			messageId: "",
			channelId: "",
			guildId: "",
			authorId: "",
			risk: 0,
			nextRunAt: 0,
			enqueuedAt: 0,
			attempts: 0,
			maxAttempts: 0,
			source: "automated",
			force: false,
			heuristicSignals: [],
			isRetry: false
		};
	}
}

/**
 * Minimal binary heap implementation used by the scheduler.
 */
class BinaryHeap<T> {
	private _heap: T[] = [];
	private readonly _compare: (a: T, b: T) => number;

	/**
	 * Creates a binary heap with optional seed data.
	 *
	 * @param compare Comparator used to define heap priority.
	 * @param initial Optional initial values to insert.
	 */
	constructor(compare: (a: T, b: T) => number, initial?: Iterable<T>) {
		this._compare = compare;

		if (initial) {
			for (const value of initial) {
				this.push(value);
			}
		}
	}

	/**
	 * Inserts a new value into the heap.
	 *
	 * @param value Value to insert.
	 */
	push(value: T): void {
		this._heap.push(value);
		this._bubbleUp(this._heap.length - 1);
	}

	/**
	 * Removes and returns the top value in the heap.
	 *
	 * @returns The top value, or undefined when heap is empty.
	 */
	pop(): T | undefined {
		if (this._heap.length === 0) return undefined;

		const top = this._heap[0];
		const end = this._heap.pop();

		if (this._heap.length > 0 && end !== undefined) {
			this._heap[0] = end;
			this._sinkDown(0);
		}

		return top;
	}

	/**
	 * Returns the top value without removing it.
	 *
	 * @returns The top value, or undefined when heap is empty.
	 */
	peek(): T | undefined {
		return this._heap[0];
	}

	/**
	 * Returns number of entries currently in the heap.
	 *
	 * @returns Heap size.
	 */
	size(): number {
		return this._heap.length;
	}

	/**
	 * Restores heap ordering by bubbling an entry up.
	 *
	 * @param index Entry index to bubble.
	 */
	private _bubbleUp(index: number): void {
		let idx = index;

		while (idx > 0) {
			const parentIndex = Math.floor((idx - 1) / 2);
			if (this._compare(this._heap[idx], this._heap[parentIndex]) >= 0) {
				break;
			}

			[this._heap[idx], this._heap[parentIndex]] = [
				this._heap[parentIndex],
				this._heap[idx]
			];
			idx = parentIndex;
		}
	}

	/**
	 * Restores heap ordering by sinking an entry down.
	 *
	 * @param index Entry index to sink.
	 */
	private _sinkDown(index: number): void {
		let idx = index;
		const length = this._heap.length;

		while (true) {
			const left = idx * 2 + 1;
			const right = idx * 2 + 2;
			let smallest = idx;

			if (left < length && this._compare(this._heap[left], this._heap[smallest]) < 0) {
				smallest = left;
			}

			if (right < length && this._compare(this._heap[right], this._heap[smallest]) < 0) {
				smallest = right;
			}

			if (smallest === idx) break;

			[this._heap[idx], this._heap[smallest]] = [this._heap[smallest], this._heap[idx]];
			idx = smallest;
		}
	}
}

/**
 * Comparator used by scheduler heaps.
 *
 * @param a First scan job.
 * @param b Second scan job.
 * @returns Negative value when a has higher priority than b.
 */
function compareScanJobs(a: ScanJob, b: ScanJob): number {
	if (a.force !== b.force) {
		return a.force ? -1 : 1;
	}

	const timeDiff = a.nextRunAt - b.nextRunAt;
	if (timeDiff !== 0) return timeDiff;

	const riskDiff = b.risk - a.risk;
	if (riskDiff !== 0) return riskDiff;

	return a.enqueuedAt - b.enqueuedAt;
}

/**
 * Returns the opposite queue identifier.
 *
 * @param queue Current queue identifier.
 * @returns The opposite queue identifier.
 */
function otherQueue(queue: QueueType): QueueType {
	return queue === "new" ? "retry" : "new";
}
