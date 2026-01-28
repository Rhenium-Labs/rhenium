import "dotenv/config.js";

import OpenAI from "openai";

import {
	init,
	prismaIntegration,
	consoleIntegration,
	nodeContextIntegration,
	consoleLoggingIntegration,
	postgresIntegration,
	captureException
} from "@sentry/node";
import { open } from "lmdb";
import { PrismaPg } from "@prisma/adapter-pg";

import { sleep } from "#utils/index.js";
import { Rhenium } from "#rhenium";
import { PrismaClient } from "#prisma/client.js";
import { MessageQueue } from "#utils/Messages.js";
import { initConfigCacheInvalidator } from "#prisma/invalidator.js";
import { CLIENT_CACHE_OPTIONS, CLIENT_INTENTS, CLIENT_PARTIALS, PROCESS_EXIT_EVENTS } from "#utils/Constants.js";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#config/GlobalConfig.js";

/** The Discord client instance. */
export const client = new Rhenium({
	intents: CLIENT_INTENTS,
	partials: CLIENT_PARTIALS,
	makeCache: CLIENT_CACHE_OPTIONS,
	sweepers: {
		users: {
			interval: 3600,
			filter: () => () => true // Sweeps everything.
		}
	},
	allowedMentions: { parse: [] }
});

/** The Prisma client instance. */
export const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.PG_URL })
}).$extends(initConfigCacheInvalidator());

/** LMDB KV. */
export const kv = open<Object, string>({
	encoding: "json",
	compression: true
});

/** OpenAI client. */
export const openAi = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY
});

async function main(): Promise<void> {
	// Cache global configuration.
	await GlobalConfig.cache();

	// Load pieces.
	await client.loadPieces();

	// Connect to the database.
	// We have to add a test query here because driver adapters in v7 can't properly determine
	// if the connection is valid without making a query for some fucking reason.
	try {
		await prisma.$connect();
		await prisma.message.findFirst();
		Logger.info("Connected to the database.");
	} catch (error) {
		Logger.fatal("Failed to connect to the database:", error);
		process.exit(1);
	}

	// Initialize Sentry for error tracking.
	init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.NODE_ENV || "production",
		tracesSampleRate: 1.0,
		profilesSampleRate: 1.0,
		sampleRate: 1.0,
		enableLogs: true,
		integrations: [
			nodeContextIntegration(),
			consoleIntegration(),
			consoleLoggingIntegration(),
			prismaIntegration(),
			postgresIntegration()
		]
	});

	// Log in to Discord.
	await client.login(process.env.BOT_TOKEN);

	// Wait for the client to stabilize, then register application commands.
	await sleep(2000);
	await client.stores.get("commands").register();
}

void main();

/** Handles storing messages on process exit events. */
PROCESS_EXIT_EVENTS.forEach(event => {
	process.on(event, async () => {
		await MessageQueue.store(event)
			.catch(error => {
				Logger.error("Error when storing messages on process exit:", error);
				process.exit(1);
			})
			.then(() => process.exit(0));
	});
});

/** Global exception and rejection handlers. */

process.on("uncaughtException", error => {
	const sentryId = captureException(error);
	Logger.tracable(sentryId, error);
});

process.on("unhandledRejection", reason => {
	const sentryId = captureException(reason);
	Logger.tracable(sentryId, reason);
});
