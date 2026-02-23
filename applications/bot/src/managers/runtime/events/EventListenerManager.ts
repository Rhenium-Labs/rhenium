import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { client } from "@root/index";
import { inflect } from "@utils/index";

import Logger from "@utils/Logger";
import EventListener from "./EventListener";

export default class EventListenerManager {
	/** Mount all event listeners from the `events` directory. */
	static async mount(): Promise<void> {
		const directory = path.resolve("src/events");

		if (!fs.existsSync(directory)) {
			Logger.fatal("Events directory not found.");
			process.exit(1);
		}

		Logger.info("Mounting event listeners...");

		// prettier-ignore
		const filenames = fs
            .readdirSync(directory)
            .filter(file => file.endsWith(""));

		if (filenames.length === 0) {
			Logger.warn("No event listeners found to mount.");
			return;
		}

		let count = 0;

		for (const filename of filenames) {
			const filepath = path.join(directory, filename);
			const url = pathToFileURL(filepath).href;

			const listenerClass = (await import(url)).default;
			const listener = new listenerClass();

			if (!(listener instanceof EventListener)) {
				Logger.warn(`${filename} does not export a valid EventListener class.`);
				continue;
			}

			let level: string;

			if (listener.once) {
				level = "ONCE";
				client.once(listener.event, (...args: any[]) => listener.execute(...args));
			} else {
				level = "ON";
				client.on(listener.event, (...args: any[]) => listener.execute(...args));
			}

			count++;

			Logger.custom(level, `Mounted listener "${listener.event}".`, {
				color: "Purple"
			});
		}

		Logger.success(`Mounted ${count} event ${inflect(count, "listener")}.`);
	}
}
