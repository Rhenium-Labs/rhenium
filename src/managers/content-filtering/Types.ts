import { Message } from "#database/Schema.js";
import { Detector } from "#database/Enums.js";

import { Snowflake } from "discord.js";

export type HeuristicMessageData = {
	message: Message;
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

export type ChannelScanState = {
	scanTimestamps: number[];
	alertCount: number;
	scanRate: number;
	falsePositiveRatio?: number;
	lastRateLog?: number;
	ewmaMpm?: number;
	loggedRateEwma?: number;
	messageTimestamps?: number[];
	betaLastUpdate?: number;
	betaA?: number;
	betaB?: number;
	flaggedUsers: Map<Snowflake, number[]>;
	lastRateIncrease: number;
	priorityAlertedUsers: Set<Snowflake>;
	userScores: Map<Snowflake, { score: number; lastScan: number }>;
};
