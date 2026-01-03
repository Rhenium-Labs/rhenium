import { type ApplicationCommandData, Collection } from "discord.js";

import fs from "node:fs";
import path from "node:path";

import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import Command from "#classes/Command.js";

export default class CommandManager {
	/**
	 * A collection of all loaded commands.
	 */

	private static store: Collection<string, Command> = new Collection();

	/**
	 * Get a command from the store by name or alias.
	 *
	 * @param name The name or alias of the command.
	 * @returns The command if found, otherwise undefined.
	 */
	public static get(name: string): Command | undefined {
		return this.store.get(name);
	}

	/**
	 * Load all commands from the `commands` directory.
	 */
	public static async load(): Promise<void> {
		const directory = path.resolve("src/commands");

		if (!fs.existsSync(directory)) {
			Logger.fatal(`Commands directory not found: ${directory}`);
			process.exit(1);
		}

		const files = fs
			.readdirSync(directory)
			.filter(file => file.endsWith(".ts"))
			.map(file => file.replace(".ts", ".js"));

		Logger.info(`Loading commands...`);

		let loadedCount = 0;

		for (const file of files) {
			try {
				await CommandManager.loadFile(file);
				loadedCount++;
			} catch (error) {
				Logger.error(`Failed to load ${file}:`, error);
				process.exit(1);
			}
		}

		Logger.success(`Loaded ${loadedCount} ${inflect(loadedCount, "command")}.`);
	}

	/**
	 * Registers application commands with Discord.
	 */
	public static async register(): Promise<void> {
		const commands: ApplicationCommandData[] = this.store
			.filter(cmd => cmd.register !== undefined)
			.map(cmd => cmd.register!());

		if (commands.length === 0) {
			Logger.info("Found no application commands to register.");
			return;
		}

		try {
			await client.application.commands.set(commands);
			Logger.success(`Registered ${commands.length} ${inflect(commands.length, "application command")}.`);
		} catch (error) {
			Logger.fatal("Failed to register application commands:", error);
			process.exit(1);
		}
	}

	/**
	 * Load a single command file.
	 *
	 * @param filename The command file to load.
	 */
	private static async loadFile(filename: string): Promise<void> {
		const commandClass = (await import(`../../commands/${filename}`)).default;
		const command = new commandClass();

		if (!(command instanceof Command)) {
			Logger.warn(`Skipping ${filename}: not a valid Command.`);
			return;
		}

		if (command.aliases.length) {
			for (const alias of command.aliases) {
				this.store.set(alias, command);
			}
		}

		this.store.set(command.name, command);
		return Logger.custom("COMMANDS", `Loaded command "${command.name}".`, { color: "Purple" });
	}
}
