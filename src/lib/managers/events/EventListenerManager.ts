import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import EventListener from "#managers/events/EventListener.js";

export default class EventListenerManager {
	/** Mounts all event listeners to the client. */
	public static async mount(): Promise<void> {
		const directory = path.resolve("dist/events");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Events directory not found: ${directory}.`);
			process.exit(1);
		}

		Logger.info(`Mounting event listeners...`);

		const filenames = fs.readdirSync(directory).filter(file => file.endsWith(".js"));
		let count = 0;

		for (const filename of filenames) {
			const filepath = path.resolve(directory, filename);
			const url = pathToFileURL(filepath);

			const listenerClass = (await import(url.href)).default;
			const listener = new listenerClass();

			if (!(listener instanceof EventListener)) {
				Logger.warn(`Skipping ${filename}: not a valid EventListener.`);
				continue;
			}

			let logLevel: string;

			if (listener.once) {
				logLevel = "ONCE";
				client.once(listener.event, (...args: any[]) => listener.onEmit(...args));
			} else {
				logLevel = "ON";
				client.on(listener.event, (...args: any[]) => listener.onEmit(...args));
			}

			count++;

			Logger.custom(logLevel, `Mounted listener "${listener.event}."`, {
				color: "Purple"
			});
		}

		Logger.success(`Mounted ${count} ${inflect(count, "event listener")}.`);
	}
}
