import fs from "node:fs";
import path from "node:path";

import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import EventListener from "#classes/EventListener.js";

export default class EventListenerManager {
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

		let loadedCount = 0;

		for (const file of files) {
			try {
				await EventListenerManager.loadFile(file);
				loadedCount++;
			} catch (error) {
				Logger.error(`Failed to load ${file}:`, error);
				process.exit(1);
			}
		}

		Logger.success(`Loaded ${loadedCount} ${inflect(loadedCount, "event listener")}.`);
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
