import { Awaitable, Events } from "discord.js";

import fs from "node:fs";
import path from "node:path";

import { inflect } from "#utils/index.js";
import { client } from "#root/index.js";

import Logger from "#utils/Logger.js";

export abstract class EventListener {
	/**
	 * The client this listener is attached to.
	 */

	public client = client;

	/**
	 * The event this listener listens to.
	 */

	public readonly event: Events | string;

	/**
	 * Whether this listener should only run once.
	 */

	public readonly once: boolean;

	/**
	 * Constructs a new event listener.
	 *
	 * @param event The event this listener listens to.
	 * @param once Whether this listener should only run once.
	 * @returns The constructed event listener.
	 */

	public constructor(event: Events | string, once = false) {
		this.event = event;
		this.once = once;
	}

	/**
	 * Method to be executed when the event is emitted.
	 *
	 * @param args The arguments emitted with the event.
	 * @returns Unknown.
	 */

	public abstract onEmit(...args: unknown[]): Awaitable<unknown>;
}

export class EventListenerManager {
	/**
	 * Load all event listeners from the `events` directory.
	 */
	public static async load(): Promise<void> {
		const directory = path.resolve("src/events");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Events directory not found: ${directory}.`);
			process.exit(1);
		}

		const files = fs
			.readdirSync(directory)
			.filter(file => file.endsWith(".ts"))
			.map(file => file.replace(".ts", ".js"));

		Logger.info(`Loading event listeners...`);

		let count: number = 0;

		for (const file of files) {
			try {
				await EventListenerManager.loadFile(file);
				count++;
			} catch (error) {
				Logger.error(`Failed to load ${file}:`, error);
				process.exit(1);
			}
		}

		Logger.success(`Loaded ${count} ${inflect(count, "event listener")}.`);
	}

	/**
	 * Load a single event listener file.
	 *
	 * @param filename The event listener file to load.
	 */
	private static async loadFile(filename: string): Promise<void> {
		const listenerClass = (await import(`../../events/${filename}`)).default;
		const listener = new listenerClass();

		if (!(listener instanceof EventListener)) {
			Logger.warn(`Skipping ${filename}: not a valid EventListener.`);
			return;
		}

		client[listener.once ? "once" : "on"](listener.event, (...args: any[]) => listener.onEmit(...args));

		return Logger.custom("EVENTS", `Mounted listener "${listener.event}."`, { color: "Purple" });
	}
}
