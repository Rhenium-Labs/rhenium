import { AliasStore, LoaderStrategy } from "@sapphire/pieces";

import { inflect } from "#utils/index.js";
import { Command } from "../structures/Command.js";

import Logger from "#utils/Logger.js";

export default class CommandStore extends AliasStore<Command, "commands"> {
	constructor() {
		super(Command, {
			name: "commands",
			strategy: new CommandLoaderStrategy()
		});
	}
}

/** Custom command loader strategy to publish commands once they're fully loaded. */
class CommandLoaderStrategy extends LoaderStrategy<Command> {
	override async onLoadAll(store: CommandStore) {
		return Logger.info(`Loaded ${store.size} ${inflect(store.size, "command")}.`);
	}

	override async onLoad(_: CommandStore, piece: Command) {
		return Logger.custom("COMMANDS", `Loaded command "${piece.name}".`, { color: "Purple" });
	}
}
