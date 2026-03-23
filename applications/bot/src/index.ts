import "dotenv/config";
import "./env.js";

import OpenAI from "openai";

import {
	init,
	consoleIntegration,
	nodeContextIntegration,
	consoleLoggingIntegration,
	postgresJsIntegration,
	captureException
} from "@sentry/node";
import { open } from "lmdb";
import { Client, Sweepers } from "discord.js";
import { createKyselyClient } from "@repo/db";

import {
	CLIENT_INTENTS,
	CLIENT_PARTIALS,
	PROCESS_EXIT_EVENTS,
	CLIENT_CACHE_OPTIONS
} from "#utils/Constants.js";
import { sleep } from "#utils/index.js";
import { startTRPCServer } from "./trpc/server.js";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#config/GlobalConfig.js";
import MessageManager from "#database/Messages.js";
import CommandManager from "#commands/CommandManager.js";
import ComponentManager from "#components/ComponentManager.js";
import EventListenerManager from "#events/EventListenerManager.js";
import ConfigCacheInvalidatorPlugin from "#managers/database/Invalidator.js";

/** The Discord client instance. */
export const client = new Client<true>({
	intents: CLIENT_INTENTS,
	partials: CLIENT_PARTIALS,
	makeCache: CLIENT_CACHE_OPTIONS,
	sweepers: {
		users: {
			interval: 3600, // 1 hour
			filter: () => (): boolean => true // Sweeps everything.
		},
		guildMembers: {
			interval: 3600, // 1 hour
			filter: Sweepers.filterByLifetime({
				lifetime: 1800 // 30 minutes
			})
		}
	},
	allowedMentions: { parse: [] }
});

/** The Kysely client instance. */
export const kysely = createKyselyClient(process.env.PG_URL, [new ConfigCacheInvalidatorPlugin()]);

/** LMDB KV. */
export const kv = open<object, string>({
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

	// Cache commands.
	await CommandManager.cache();

	// Cache components.
	await ComponentManager.cache();

	// Mount event listeners.
	await EventListenerManager.mount();

	// Attempt to connect to the database.
	// We run a simple test query to ensure the connection is valid.
	try {
		await kysely
			.selectFrom("Message")
			.selectAll()
			.limit(1)
			.executeTakeFirst()
			.then(() => Logger.info("Connected to the database."));
	} catch (error) {
		Logger.fatal("Failed to connect to the database:", error);
		process.exit(1);
	}

	// Initialize Sentry for error tracking.
	init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.NODE_ENV || "production",
		tracesSampleRate: 1.0,
		sampleRate: 1.0,
		enableLogs: true,
		integrations: [
			nodeContextIntegration(),
			consoleIntegration(),
			consoleLoggingIntegration(),
			postgresJsIntegration()
		]
	});

	// Log in to Discord.
	await client.login(process.env.BOT_TOKEN);

	// Start the tRPC API server for the dashboard.
	await startTRPCServer();

	// Register application commands.
	await sleep(2000); // Short delay since this likes to fail if done immediately.
	await CommandManager.register();
}

void main();

/** Handles storing messages on process exit events. */
PROCESS_EXIT_EVENTS.forEach(event => {
	process.on(event, async () => {
		await MessageManager.insert(event)
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
	Logger.traceable(sentryId, error);
});

process.on("unhandledRejection", reason => {
	const sentryId = captureException(reason);
	Logger.traceable(sentryId, reason);
});
