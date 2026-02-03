import { container, getRootData, StoreRegistry } from "@sapphire/pieces";
import { Client, type ClientOptions } from "discord.js";

import path from "path";

import EventListenerStore from "../stores/EventListeners.js";
import ComponentStore from "../stores/Components.js";
import CommandStore from "../stores/Commands.js";

export class Rhenium extends Client<true> {
	/** Store registry. */
	stores: StoreRegistry;

	constructor(options: ClientOptions) {
		super(options);

		/** Register all stores. */
		container.stores.register(new CommandStore());
		container.stores.register(new ComponentStore());
		container.stores.register(new EventListenerStore());

		this.stores = container.stores;
	}

	/**
	 * Loads all pieces without logging in the client.
	 * @returns A promise that resolves when all pieces are loaded.
	 */

	init(): Promise<void[]> {
		// Register the `src` directory as a pieces path.
		this.stores.registerPath(path.join(getRootData().root));
		return Promise.all([...this.stores.values()].map(store => store.loadAll()));
	}
}
