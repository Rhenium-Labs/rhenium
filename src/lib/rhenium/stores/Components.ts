import { LoaderStrategy, Store } from "@sapphire/pieces";

import { inflect } from "#utils/index.js";
import { Component } from "../structures/Component.js";

import Logger from "#utils/Logger.js";

export default class ComponentStore extends Store<Component, "components"> {
	constructor() {
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
	override get(customId: string): Component | undefined {
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
	override async onLoadAll(store: ComponentStore) {
		return Logger.info(`Loaded ${store.size} ${inflect(store.size, "component")}.`);
	}

	override async onLoad(_: ComponentStore, piece: Component) {
		const customId = Component.parseCustomId(piece.id);

		return Logger.custom("COMPONENTS", `Loaded component "${customId}".`, {
			color: "Cyan"
		});
	}
}
