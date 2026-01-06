import { type ApplicationCommandData, Collection } from "discord.js";
import { pathToFileURL } from "node:url";

import fs from "node:fs";
import path from "node:path";

import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import Command from "./Command.js";

export default class CommandManager {
	/** Collection of all cached commands. */
	private static readonly _cache: Collection<string, Command> = new Collection();

	/**
	 * Get a command from the cache.
	 *
	 * @param name The name or alias of the command.
	 * @returns The command if found, otherwise undefined.
	 */
	public static get(name: string): Command | undefined {
		return this._cache.get(name);
	}

	/** Cache all commands from the `commands` directory. */
	public static async cache(): Promise<void> {
		const directory = path.resolve("dist/commands");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Commands directory not found: ${directory}`);
			process.exit(1);
		}

		Logger.info("Caching commands...");

		const filenames = fs.readdirSync(directory).filter(file => file.endsWith(".js"));
		let count = 0;

		for (const filename of filenames) {
			const filepath = path.resolve(directory, filename);
			const url = pathToFileURL(filepath);

			const commandClass = (await import(url.href)).default;
			const command = new commandClass();

			if (!(command instanceof Command)) {
				Logger.warn(`${filename} is not a valid command.`);
				continue;
			}

			if (command.aliases.length) {
				for (const alias of command.aliases) {
					this._cache.set(alias, command);
				}
			}

			this._cache.set(command.name, command);
			count++;

			Logger.custom("COMMANDS", `Cached command "${command.name}".`, { color: "Purple" });
		}

		Logger.info(`Cached ${count} ${inflect(count, "command")}.`);
	}

	/** Registers application commands with Discord. */
	public static async register(): Promise<void> {
		const commands: ApplicationCommandData[] = this._cache
			.filter(cmd => cmd.register !== undefined)
			.map(cmd => cmd.register!());

		if (commands.length === 0) {
			Logger.info("Found no application commands to register.");
			return;
		}

		const set = await client.application.commands
			.set(commands)
			.then(() => ({ success: true, error: null }))
			.catch(error => ({ success: false, error }));

		if (!set.success) {
			Logger.error("Failed to register application commands:", set.error);
			process.exit(1);
		}

		Logger.success(`Registered ${commands.length} ${inflect(commands.length, "application command")}.`);
	}
}
