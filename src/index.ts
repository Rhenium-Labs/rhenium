import "dotenv/config.js";

import OpenAI from "openai";
import postgres from "postgres";

import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";

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
import { Sweepers } from "discord.js";

import { sleep } from "#utils/index.js";
import { Rhenium } from "#rhenium";
import {
	CLIENT_CACHE_OPTIONS,
	CLIENT_INTENTS,
	CLIENT_PARTIALS,
	PROCESS_EXIT_EVENTS
} from "#utils/Constants.js";

import type { DB } from "./lib/kysely/Schema.js";

import Logger from "#utils/Logger.js";
import Messages from "#utils/Messages.js";
import GlobalConfig from "#config/GlobalConfig.js";
import ConfigCacheInvalidatorPlugin from "#kysely/plugins/ConfigCacheInvalidator.js";

/** The Discord client instance. */
export const client = new Rhenium({
	intents: CLIENT_INTENTS,
	partials: CLIENT_PARTIALS,
	makeCache: CLIENT_CACHE_OPTIONS,
	sweepers: {
		users: {
			interval: 3600,
			filter: () => (): boolean => true // Sweeps everything.
		},
		guildMembers: {
			interval: 3600,
			filter: Sweepers.filterByLifetime({
				lifetime: 1800 // 30 minutes
			})
		}
	},
	allowedMentions: { parse: [] }
});

/** The Kysely client instance. */
export const kysely = new Kysely<DB>({
	dialect: new PostgresJSDialect({
		postgres: postgres(process.env.PG_URL)
	}),
	plugins: [new ConfigCacheInvalidatorPlugin()]
});

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

	// Load pieces.
	await client.loadPieces();

	// Attempt to connect to the database.
	// We run a simple test query to ensure the connection is valid.
	try {
		await kysely.selectFrom("Message").selectAll().limit(1).executeTakeFirst();
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
		await Messages.store(event)
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
