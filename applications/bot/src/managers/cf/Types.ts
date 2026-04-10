import type { Message as SerializedMessage, Detector } from "@repo/db";
import type { Snowflake } from "discord.js";

export type HeuristicMessageData = {
	message: SerializedMessage;
	score: number;
};

export type HeuristicData = {
	standardScore: number;
	referenceData: HeuristicMessageData[];
};

export type ContentPredictionData = {
	content: string;
	score?: string;
};

export type ContentPredictions = {
	data: ContentPredictionData[];
	detector: Detector | null;
	content: string[] | null;
};

export type UserScoreEntry = {
	score: number;
	lastScan: number;
};

export type ChannelScanState = {
	guildId: Snowflake | null;
	scanTimestamps: number[];
	alertCount: number;
	scanRate: number;
	falsePositiveRatio: number;
	lastRateLog: number;
	ewmaMpm: number;
	loggedRateEwma: number;
	messageTimestamps: number[];
	betaLastUpdate: number;
	betaA: number;
	betaB: number;
	flaggedUsers: Map<Snowflake, number[]>;
	lastRateIncrease: number;
	priorityAlertedUsers: Set<Snowflake>;
	userScores: Map<Snowflake, UserScoreEntry>;
	lastActivity: number;
};

export type ScanJobSource = "automated" | "heuristic";

export type ScanJob = {
	jobId: string;
	dedupeKey: string;
	messageId: Snowflake;
	channelId: Snowflake;
	guildId: Snowflake;
	authorId: Snowflake;
	risk: number;
	nextRunAt: number;
	enqueuedAt: number;
	attempts: number;
	maxAttempts: number;
	source: ScanJobSource;
	force: boolean;
	heuristicSignals: string[];
	isRetry: boolean;
};

export type DeadLetterEntry = {
	id: string;
	createdAt: number;
	reason: string;
	job: Pick<
		ScanJob,
		| "jobId"
		| "source"
		| "guildId"
		| "channelId"
		| "messageId"
		| "authorId"
		| "attempts"
		| "maxAttempts"
		| "risk"
	>;
	error?: string;
};

export type ChannelStateSnapshot = {
	channelId: Snowflake;
	guildId: Snowflake | null;
	queueDepth: number;
	scanRate: number;
	ewmaMpm: number;
	falsePositiveRatio: number;
	priorityUsers: number;
	trackedUsers: number;
	flaggedUsers: number;
	lastActivity: number;
	pendingScansInWindow: number;
};

export type QueueSnapshot = {
	total: number;
	newJobs: number;
	retryJobs: number;
	oldestEnqueuedAt: number | null;
	nextScheduledAt: number | null;
};
