import { Collection } from "discord.js";

import fs from "node:fs";
import path from "node:path";

import { inflect } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import Component, { type ComponentCustomID } from "#classes/Component.js";

export default class ComponentManager {
	/**
	 * The store of registered components.
	 */
	public static readonly store: Collection<ComponentCustomID, Component> = new Collection();

	/**
	 * Get a component from the store by its custom ID.
	 *
	 * @param customId The custom ID of the component.
	 * @returns The component if found, otherwise undefined.
	 */
	public static get(customId: string): Component | undefined {
		return this.store.find(component => {
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

	/**
	 * Load all components from the `components` directory.
	 */
	public static async load(): Promise<void> {
		const directory = path.resolve("src/components");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Components directory not found: ${directory}.`);
			process.exit(1);
		}

		const files = fs
			.readdirSync(directory)
			.filter(file => file.endsWith(".ts"))
			.map(file => file.replace(".ts", ".js"));

		Logger.info(`Loading components...`);

		let loadedCount = 0;

		for (const file of files) {
			try {
				await this.loadFile(file);
				loadedCount++;
			} catch (error) {
				Logger.error(`Failed to load ${file}:`, error);
				process.exit(1);
			}
		}

		Logger.success(`Loaded ${loadedCount} ${inflect(loadedCount, "component")}.`);
	}

	/**
	 * Load a single component from a file.
	 *
	 * @param filename The file to load the component from.
	 */

	public static async loadFile(filename: string): Promise<void> {
		const componentClass = (await import(`../../components/${filename}`)).default;
		const component = new componentClass();

		if (!(component instanceof Component)) {
			Logger.warn(`Skipping ${filename}: not a valid Component.`);
			return;
		}

		this.store.set(component.id, component);

		return Logger.custom("COMPONENTS", `Loaded component: ${this._parseComponentCustomId(component.id)}`, {
			color: "Cyan"
		});
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
