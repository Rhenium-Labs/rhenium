import { ArgumentStream, IUnorderedStrategy, Lexer, Parser } from "@sapphire/lexure";
import { ApplicationCommandData, Awaitable, Collection, CommandInteraction, Message } from "discord.js";

import fs from "node:fs";
import path from "node:path";

import { client } from "#root/index.js";
import { inflect } from "#utils/index.js";

import type { InteractionReplyData, MessageReplyData } from "#utils/Types.js";

import Args from "./Args.js";
import Logger from "#utils/Logger.js";
import FlagStrategy from "./FlagStrategy.js";

export abstract class Command {
	/**
	 * The client this command belongs to.
	 */

	public client = client;

	/**
	 * The name of the command.
	 */

	public readonly name: string;

	/**
	 * The aliases of the command.
	 */

	public readonly aliases: string[];

	/**
	 * The description of the command.
	 */

	public readonly description: string;

	/**
	 * The lexer of the command.
	 */

	private readonly lexer: Lexer;

	/**
	 * The strategy to use for the parser.
	 */

	private readonly strategy: IUnorderedStrategy;

	/**
	 * Constructs a new command instance.
	 *
	 * @param options The command options.
	 * @return The constructed command instance.
	 */

	public constructor(options: CommandOptions) {
		const { name, aliases, description, flags } = options;

		this.name = name;
		this.aliases = aliases ?? [];
		this.description = description;

		this.lexer = new Lexer({ quotes: [] });
		this.strategy = new FlagStrategy(Command._getStrategyOptions(flags ?? []));
	}

	/**
	 * Get the argument handler for the command.
	 * This is used to parse the arguments passed to the command.
	 *
	 * @param message The message that triggered the command.
	 * @param parameters The parameters passed to the command.
	 */

	public getArgsClass(message: Message<true>, parameters: string): Args {
		const parser = new Parser(this.strategy);
		const stream = new ArgumentStream(parser.run(this.lexer.run(parameters)));
		return new Args(message, stream);
	}

	/**
	 * Method to register an application command with Discord.
	 * This method should be implemented by subclasses to provide the command's data.
	 */

	public register?(): ApplicationCommandData;

	/**
	 * Handles interaction based command execution.
	 *
	 * @param interaction The command interaction.
	 * @return The result of the command execution.
	 */

	public interactionRun?(interaction: CommandInteraction<"cached">): Awaitable<InteractionReplyData | null>;

	/**
	 * Handles message based command execution.
	 *
	 * @param message The message that triggered the command.
	 * @param args The argument parser instance.
	 * @return The result of the command execution.
	 */

	public messageRun?(message: Message<true>, args: Args): Awaitable<MessageReplyData | null>;

	/**
	 * Parses the flags array passed to the command and returns the flags and options.
	 *
	 * @param flags The flags to parse.
	 * @returns An object containing the flags and options.
	 */

	private static _getStrategyOptions(flags: FlagsArray): { flags: string[]; options: string[] } {
		return flags.reduce<{ flags: string[]; options: string[] }>(
			(acc, flag) => {
				const destination = flag.acceptsValue ? acc.options : acc.flags;
				destination.push(...flag.keys);
				return acc;
			},
			{ flags: [], options: [] }
		);
	}
}

export class CommandManager {
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

export type CommandOptions = {
	name: string;
	aliases?: string[];
	description: string;
	flags?: FlagsArray;
};

type FlagsArray = { keys: string[]; acceptsValue: boolean }[];
