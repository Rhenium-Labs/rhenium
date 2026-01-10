import "dotenv/config.js";

import {
	init,
	prismaIntegration,
	consoleIntegration,
	nodeContextIntegration,
	consoleLoggingIntegration,
	postgresIntegration,
	onUncaughtExceptionIntegration,
	onUnhandledRejectionIntegration
} from "@sentry/node";
import { open } from "lmdb";
import { PrismaPg } from "@prisma/adapter-pg";

import { sleep } from "#utils/index.js";
import { PrismaClient } from "#prisma/client.js";
import { MessageQueue } from "#utils/Messages.js";
import { PROCESS_EXIT_EVENTS } from "#utils/Constants.js";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#managers/config/GlobalConfig.js";
import StrafeStryker from "#structures/Client.js";
import CommandManager from "#managers/commands/CommandManager.js";
import ComponentManager from "#managers/components/ComponentManager.js";
import EventListenerManager from "#managers/events/EventListenerManager.js";

/** The Discord client instance. */
export const client = new StrafeStryker();

/** The Prisma client instance. */
export const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.PG_URL })
});

/** LMDB KV. */
export const kv = open<Object, string>({
	encoding: "json",
	compression: true
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

	// Connect to the database.
	try {
		await prisma.$connect();
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
			postgresIntegration(),
			onUncaughtExceptionIntegration(),
			onUnhandledRejectionIntegration()
		]
	});

	// Log in to Discord.
	await client.login(process.env.BOT_TOKEN);

	// Wait for the client to stabilize, then register application commands.
	await sleep(2000);
	await CommandManager.register();
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
			.then(() => {
				process.exit(0);
			});
	});
});
