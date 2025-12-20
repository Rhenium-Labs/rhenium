import { Awaitable, Collection, MessageComponentInteraction, ModalSubmitInteraction } from "discord.js";

import path from "node:path";
import fs from "node:fs";

import { client } from "#root/index.js";
import type { InteractionReplyData } from "#utils/Types.js";

import Logger from "#utils/Logger.js";
import { inflect } from "#utils/index.js";

export abstract class Component {
	/**
	 * The client this component is associated with.
	 */

	public readonly client = client;

	/**
	 * The component's custom ID.
	 */

	public readonly id: ComponentCustomID;

	/**
	 * Constructs a new component.
	 *
	 * @param customId The custom ID for the component.
	 * @returns A new Component instance.
	 */

	public constructor(customId: ComponentCustomID) {
		this.id = customId;
	}

	/**
	 * Method used to be executed when the component is interacted with.
	 *
	 * @param interaction The component interaction.
	 * @returns The result of the component interaction.
	 */

	abstract run(interaction: ComponentInteraction): Awaitable<InteractionReplyData | null>;
}

export class ComponentManager {
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

		let count: number = 0;

		for (const file of files) {
			try {
				await this.loadFile(file);
				count++;
			} catch (error) {
				Logger.error(`Failed to load ${file}:`, error);
				process.exit(1);
			}
		}

		Logger.success(`Loaded ${count} ${inflect(count, "component")}.`);
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

export type ComponentCustomID =
	| string
	| { startsWith: string }
	| { endsWith: string }
	| { includes: string }
	| { matches: RegExp };

export type ComponentInteraction = MessageComponentInteraction<"cached"> | ModalSubmitInteraction<"cached">;
