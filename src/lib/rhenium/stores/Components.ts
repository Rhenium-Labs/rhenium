import { LoaderStrategy, Store } from "@sapphire/pieces";

import { inflect } from "#utils/index.js";
import { Component, type ComponentCustomID } from "../structures/Component.js";

import Logger from "#utils/Logger.js";

export default class ComponentStore extends Store<Component, "components"> {
	public constructor() {
		super(Component, {
			name: "components",
			strategy: new ComponentLoaderStrategy()
		});
	}

	/**
	 * Get a component from the cache by its custom ID.
	 *
	 * @param customId The custom ID of the component.
	 * @returns The component if found, otherwise undefined.
	 */
	public override get(customId: string): Component | undefined {
		return this.find(component => {
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
}

/** Custom loader strategy for components. */
class ComponentLoaderStrategy extends LoaderStrategy<Component> {
	public override async onLoadAll(store: ComponentStore) {
		return Logger.info(`Loaded ${store.size} ${inflect(store.size, "component")}.`);
	}

	public override async onLoad(_: ComponentStore, piece: Component) {
		return Logger.custom(
			"COMPONENTS",
			`Loaded component "${ComponentLoaderStrategy.parseComponentCustomId(piece.id)}".`,
			{
				color: "Cyan"
			}
		);
	}

	/**
	 * Parses a string/object custom ID to a string.
	 *
	 * @param customId The custom ID to parse.
	 * @returns The parsed custom ID as a string.
	 */
	static parseComponentCustomId(customId: ComponentCustomID): string {
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
