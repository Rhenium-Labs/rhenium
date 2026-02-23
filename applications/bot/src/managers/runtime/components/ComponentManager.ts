import { Collection } from "discord.js";
import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { inflect } from "@utils/index";

import Logger from "@utils/Logger";
import Component, { type ComponentCustomID } from "./Component";

export default class ComponentManager {
	/** Collection of cached components. */
	private static _cache: Collection<ComponentCustomID, Component> = new Collection();

	/**
	 * Get a component from the cache by its custom ID.
	 *
	 * @param customId The custom ID of the component to retrieve.
	 * @return The component if found, otherwise undefined.
	 */

	static get(customId: string): Component | undefined {
		return this._cache.find(component => {
			if (typeof component.customId === "string") {
				return component.customId === customId;
			}

			if ("matches" in component.customId) {
				return customId.match(component.customId.matches);
			}

			if ("startsWith" in component.customId) {
				return customId.startsWith(component.customId.startsWith);
			}

			if ("endsWith" in component.customId) {
				return customId.endsWith(component.customId.endsWith);
			}

			return customId.includes(component.customId.includes);
		});
	}

	/** Cache all components from the `components` directory. */
	static async cache(): Promise<void> {
		const directory = path.resolve("src/components");

		if (!fs.existsSync(directory)) {
			Logger.fatal("Components directory not found.");
			process.exit(1);
		}

		Logger.info("Caching components...");

		// prettier-ignore
		const filenames = fs
            .readdirSync(directory)
            .filter(file => file.endsWith(""));

		if (filenames.length === 0) {
			Logger.warn("No components found to cache.");
			return;
		}

		let count = 0;

		for (const filename of filenames) {
			const filepath = path.join(directory, filename);
			const url = pathToFileURL(filepath).href;

			const componentClass = (await import(url)).default;
			const component = new componentClass();

			if (!(component instanceof Component)) {
				Logger.warn(`${filename} does not export a valid Component class.`);
				continue;
			}

			this._cache.set(component.customId, component);
			count++;

			const customId = ComponentManager._parseComponentCustomId(component.customId);
			Logger.custom("COMPONENTS", `Cached component "${customId}".`, {
				color: "Cyan"
			});
		}

		Logger.success(`Cached ${count} component ${inflect(count, "component")}.`);
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
