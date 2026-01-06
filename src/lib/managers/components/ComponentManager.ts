import { Collection } from "discord.js";
import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { inflect } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import Component, { type ComponentCustomID } from "./Component.js";

export default class ComponentManager {
	/** Collection of all cached components. */
	private static readonly _cache: Collection<ComponentCustomID, Component> = new Collection();

	/**
	 * Get a component from the cache by its custom ID.
	 *
	 * @param customId The custom ID of the component.
	 * @returns The component if found, otherwise undefined.
	 */
	public static get(customId: string): Component | undefined {
		return this._cache.find(component => {
			if (typeof component.id === "string") {
				return component.id === customId;
			}

			if ("matches" in component.id) {
				return customId.match(component.id.matches);
			}

			if ("startsWith" in component.id) {
				return customId.startsWith(component.id.startsWith);
			}

			if ("endsWith" in component.id) {
				return customId.endsWith(component.id.endsWith);
			}

			return customId.includes(component.id.includes);
		});
	}

	/** Cache all components from the `components` directory. */
	public static async cache(): Promise<void> {
		const directory = path.resolve("dist/components");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Components directory not found: ${directory}`);
			process.exit(1);
		}

		Logger.info("Caching components...");

		const filenames = fs.readdirSync(directory).filter(file => file.endsWith(".js"));
		let count = 0;

		for (const filename of filenames) {
			const filepath = path.resolve(directory, filename);
			const url = pathToFileURL(filepath);

			const componentClass = (await import(url.href)).default;
			const component = new componentClass();

			if (!(component instanceof Component)) {
				Logger.warn(`${filename} is not a valid component.`);
				continue;
			}

			this._cache.set(component.id, component);
			count++;

			Logger.custom("COMPONENTS", `Cached component "${this._parseComponentCustomId(component.id)}".`, {
				color: "Cyan"
			});
		}

		Logger.info(`Cached ${count} ${inflect(count, "component")}.`);
	}

	/**
	 * Parses a string/object custom ID to a string.
	 *
	 * @param customId The custom ID to parse.
	 * @returns The parsed custom ID as a string.
	 */
	private static _parseComponentCustomId(customId: ComponentCustomID): string {
		if (typeof customId === "string") {
			return customId;
		}

		switch (true) {
			case "matches" in customId:
				return `matches(${customId.matches.toString()})`;
			case "startsWith" in customId:
				return `startsWith(${customId.startsWith})`;
			case "endsWith" in customId:
				return `endsWith(${customId.endsWith})`;
			case "includes" in customId:
				return `includes(${customId.includes})`;
			default:
				return "unknown";
		}
	}
}
