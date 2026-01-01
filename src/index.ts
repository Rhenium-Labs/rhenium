import "dotenv/config.js";

import {
	init,
	prismaIntegration,
	consoleIntegration,
	nodeContextIntegration,
	consoleLoggingIntegration
} from "@sentry/node";
import { Redis } from "@upstash/redis";
import { PrismaPg } from "@prisma/adapter-pg";

import { sleep } from "#utils/index.js";
import { PrismaClient } from "#prisma/client.js";
import { CommandManager } from "#classes/Command.js";
import { ComponentManager } from "#classes/Component.js";
import { EventListenerManager } from "#classes/EventListener.js";

import Logger from "#utils/Logger.js";
import StrafeStryker from "#classes/Client.js";

/** The Discord client instance. */
export const client = new StrafeStryker();

/** The Prisma client instance. */
export const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.PG_URL })
});

/** Redis client instance, powered by Upstash. */
export const kv = Redis.fromEnv();

async function main(): Promise<void> {
	// Load commands.
	await CommandManager.load();

	// Load components.
	await ComponentManager.load();

	// Load event listeners.
	await EventListenerManager.load();

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
			prismaIntegration()
		]
	});

	Logger.success("Sentry initialized.");

	// Log in to Discord.
	await client.login(process.env.BOT_TOKEN);

	// Wait for the client to stabilize, then register application commands.
	await sleep(2000);
	await CommandManager.register();
}

void main();
