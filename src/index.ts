import "dotenv/config.js";

import { Redis } from "@upstash/redis";
import { PrismaPg } from "@prisma/adapter-pg";

import { sleep } from "#utils/index.js";
import { PrismaClient } from "#prisma/client.js";
import { CommandManager } from "#classes/Command.js";
import { ComponentManager } from "#classes/Component.js";
import { EventListenerManager } from "#classes/EventListener.js";

import Logger from "#utils/Logger.js";
import StrafeStryker from "#classes/Client.js";

/**
 * The Discord client instance.
 */

export const client = new StrafeStryker();

/**
 * The Prisma client instance.
 */

export const prisma = new PrismaClient({
	adapter: new PrismaPg({
		connectionString: process.env.PG_URL
	})
});

/**
 * Redis client instance, powered by upstash.
 */

export const kv = Redis.fromEnv();

async function main(): Promise<void> {
	if (!process.env.BOT_TOKEN) {
		throw new Error("Missing BOT_TOKEN in environment variables.");
	}

	if (!process.env.PG_URL) {
		throw new Error("Missing PG_URL in environment variables.");
	}

	// Load all commands.
	await CommandManager.load();

	// Load all components.
	await ComponentManager.load();

	// Load all event listeners.
	await EventListenerManager.load();

	// Connect to the database.
	await prisma
		.$connect()
		.then(() => {
			Logger.info("Connected to the database.");
		})
		.catch(error => {
			Logger.fatal("Failed to connect to the database:", error);
			process.exit(1);
		});

	// Log in to Discord with the bot token.
	await client.login(process.env.BOT_TOKEN);

	// Wait for 2 seconds then handle command registration.
	await sleep(2000);
	await CommandManager.register();
}

void main();
