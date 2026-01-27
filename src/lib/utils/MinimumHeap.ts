import type { Snowflake } from "discord.js";

/** Maximum number of entries in the priority queue to prevent unbounded growth. */
const MAX_HEAP_SIZE = 10000;

/** Maximum age of an entry before it's considered stale (5 minutes). */
const MAX_ENTRY_AGE_MS = 5 * 60 * 1000;

export default class MinimumHeap {
	/** Internal array storing heap entries */
	private heap: PriorityQueueEntry[] = [];

	/** Tracks the last cleanup time. */
	private lastCleanup: number = Date.now();

	/**
	 * Compares two entries to determine their relative priority.
	 *
	 * @param a First entry to compare.
	 * @param b Second entry to compare.
	 * @returns Negative if `a` has higher priority, positive if `b` has higher priority, zero if equal.
	 */
	private compare(a: PriorityQueueEntry, b: PriorityQueueEntry): number {
		// Primary sort: by nextScan time (ascending).
		const timeDiff = a.nextScan - b.nextScan;
		if (timeDiff !== 0) return timeDiff;

		// Secondary sort: by risk (descending - higher risk = higher priority).
		return b.risk - a.risk;
	}

	/** Add a new entry to the heap. Enforces size limits. */
	public push(entry: PriorityQueueEntry): void {
		const now = Date.now();

		if (now - this.lastCleanup > 60000) {
			this.pruneStaleEntries(now);
			this.lastCleanup = now;
		}

		// If at capacity, only add if this entry has higher priority than worst.
		if (this.heap.length >= MAX_HEAP_SIZE) {
			// Find and remove the lowest priority entry (highest nextScan time).
			let worstIdx = 0;

			for (let i = 1; i < this.heap.length; i++) {
				if (this.compare(this.heap[i], this.heap[worstIdx]) > 0) {
					worstIdx = i;
				}
			}

			// Only replace if new entry is better
			if (this.compare(entry, this.heap[worstIdx]) < 0) {
				this.heap[worstIdx] = entry;
				this.rebuildHeap();
			}
			return;
		}

		this.heap.push(entry);
		this.bubbleUp();
	}

	/** Remove entries that are too old to be relevant. */
	private pruneStaleEntries(now: number): void {
		const cutoff = now - MAX_ENTRY_AGE_MS;
		const before = this.heap.length;

		this.heap = this.heap.filter(e => e.enqueuedAt > cutoff);

		if (this.heap.length !== before) {
			this.rebuildHeap();
		}
	}

	/** Rebuild the entire heap from scratch. */
	private rebuildHeap(): void {
		const entries = [...this.heap];
		this.heap = [];

		for (const entry of entries) {
			this.heap.push(entry);
			this.bubbleUp();
		}
	}

	/**
	 * Removes and returns the entry with the highest priority (minimum value).
	 *
	 * @returns The entry with highest priority, or `undefined` if the heap is empty.
	 */
	public pop(): PriorityQueueEntry | undefined {
		if (this.heap.length === 0) return undefined;

		const top = this.heap[0];
		const end = this.heap.pop();

		// Move last element to root and restore heap property.
		if (this.heap.length > 0 && end) {
			this.heap[0] = end;
			this.sinkDown();
		}

		return top;
	}

	/** Returns the entry with the highest priority without removing it. */
	public peek(): PriorityQueueEntry | undefined {
		return this.heap[0];
	}

	/** Returns the number of entries in the heap. */
	public size(): number {
		return this.heap.length;
	}

	/** Checks if the heap is empty. */
	public isEmpty(): boolean {
		return this.heap.length === 0;
	}

	/** Restores heap property by moving the last element up to its correct position. */
	private bubbleUp(): void {
		let idx = this.heap.length - 1;
		const entry = this.heap[idx];

		while (idx > 0) {
			const parentIdx = Math.floor((idx - 1) / 2);
			const parent = this.heap[parentIdx];

			// Stop if parent has higher or equal priority.
			if (this.compare(entry, parent) >= 0) break;

			// Swap with parent and continue.
			this.heap[parentIdx] = entry;
			this.heap[idx] = parent;
			idx = parentIdx;
		}
	}

	/** Restores heap property by moving the root element down to its correct position. */
	private sinkDown(): void {
		let idx = 0;
		const length = this.heap.length;
		const entry = this.heap[0];

		while (true) {
			const leftIdx = 2 * idx + 1;
			const rightIdx = 2 * idx + 2;
			let swapIdx: number | null = null;

			// Check if left child has higher priority
			if (leftIdx < length && this.compare(this.heap[leftIdx], entry) < 0) {
				swapIdx = leftIdx;
			}

			// Check if right child has higher priority than both current and left.
			if (rightIdx < length) {
				const rightHasHigherPriority =
					(swapIdx === null && this.compare(this.heap[rightIdx], entry) < 0) ||
					(swapIdx !== null && this.compare(this.heap[rightIdx], this.heap[leftIdx]) < 0);

				if (rightHasHigherPriority) {
					swapIdx = rightIdx;
				}
			}

			// Stop if no swap needed (heap property satisfied).
			if (swapIdx === null) break;

			// Swap with child and continue
			this.heap[idx] = this.heap[swapIdx];
			this.heap[swapIdx] = entry;
			idx = swapIdx;
		}
	}
}

/** Priority queue entry for message scanning.
 * Stores only IDs and lightweight data to minimize memory usage.
 */
export type PriorityQueueEntry = {
	/** The ID of the user who sent the message */
	userId: Snowflake;
	/** The ID of the channel where the message was sent */
	channelId: Snowflake;
	/** The ID of the message to be scanned */
	messageId: Snowflake;
	/** The ID of the guild where the message was sent */
	guildId: Snowflake;
	/** Risk score associated with the message (higher = more risky) */
	risk: number;
	/** Timestamp for when the message should next be scanned */
	nextScan: number;
	/** Timestamp when this entry was enqueued (for staleness checks) */
	enqueuedAt: number;
};
