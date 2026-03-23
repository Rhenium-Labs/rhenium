import { ApplicationCommandData, Collection } from "discord.js";
import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";

import Command from "./Command.js";
import Logger from "#utils/Logger.js";

export default class CommandManager {
	/** Collection of cached commands. */
	private static _cache: Collection<string, Command> = new Collection();

	/**
	 * Get a command from the cache by its name.
	 *
	 * @param name The name of the command to retrieve.
	 * @return The command if found, otherwise undefined.
	 */
	static get(name: string): Command | undefined {
		return this._cache.get(name);
	}

	/** Cache all commands from the `commands` directory. */
	static async cache(): Promise<void> {
		const directory = path.resolve("dist/commands");

		if (!fs.existsSync(directory)) {
			Logger.fatal("Commands directory not found.");
			process.exit(1);
		}

		Logger.info("Caching commands...");

		// prettier-ignore
		const filenames = fs
            .readdirSync(directory)
            .filter(file => file.endsWith(".js"));

		if (filenames.length === 0) {
			Logger.warn("No commands found to cache.");
			return;
		}

		let count = 0;

		for (const filename of filenames) {
			const filepath = path.join(directory, filename);
			const url = pathToFileURL(filepath).href;

			const commandClass = (await import(url)).default;
			const command = new commandClass();

			if (!(command instanceof Command)) {
				Logger.warn(`${filename} does not export a valid Command class.`);
				continue;
			}

			if (command.register && !command.executeInteraction) {
				Logger.warn(
					`${filename} defines a register method but does not implement executeInteraction.`
				);
				continue;
			}

			this._cache.set(command.name, command);

			for (const alias of command.aliases) {
				this._cache.set(alias, command);
			}

			count++;
			Logger.custom("COMMANDS", `Cached command "${command.name}".`, { color: "Purple" });
		}

		Logger.success(`Cached ${count} command ${inflect(count, "command")}.`);
	}

	/** Registers application commands with Discord. */
	static async register(): Promise<void> {
		const commands: ApplicationCommandData[] = this._cache
			.filter(cmd => cmd.register !== undefined)
			.map(cmd => cmd.register!());

		if (commands.length === 0) {
			Logger.info("Found no application commands to register.");
			return;
		}

		const set = await client.application.commands.set(commands).catch(error => {
			Logger.error("Failed to register application commands:", error);
			return null;
		});

		if (!set) {
			process.exit(1);
		}

		Logger.success(`Registered ${set.size} application ${inflect(set.size, "command")}.`);
	}
}
