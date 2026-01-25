import { LoaderStrategy, Store } from "@sapphire/pieces";

import { EventListener } from "../structures/EventListener.js";
import { inflect } from "#utils/index.js";
import { client } from "#root/index.js";

import Logger from "#utils/Logger.js";

export default class EventListenerStore extends Store<EventListener, "events"> {
	public constructor() {
		super(EventListener, {
			name: "events",
			strategy: new EventListenerLoaderStrategy()
		});
	}
}

/** Custom loader strategy for event listeners. */
class EventListenerLoaderStrategy extends LoaderStrategy<EventListener> {
	public override async onLoadAll(store: EventListenerStore) {
		return Logger.info(`Mounted ${store.size} ${inflect(store.size, "event listener")}.`);
	}

	public override async onLoad(_: EventListenerStore, piece: EventListener) {
		let logLevel: string;

		if (piece.once) {
			logLevel = "ONCE";
			client.once(piece.event, (...args: any[]) => piece.onEmit(...args));
		} else {
			logLevel = "ON";
			client.on(piece.event, (...args: any[]) => piece.onEmit(...args));
		}

		Logger.custom(logLevel, `Mounted listener "${piece.event}."`, {
			color: "Purple"
		});
	}
}
