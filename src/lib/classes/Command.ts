import { type IUnorderedStrategy, ArgumentStream, Lexer, Parser } from "@sapphire/lexure";
import type { ApplicationCommandData, Awaitable, CommandInteraction, Message } from "discord.js";

import { client, prisma } from "#root/index.js";

import type { InteractionReplyData, MessageReplyData } from "#utils/Types.js";

import Args from "./Args.js";
import FlagStrategy from "./FlagStrategy.js";

export default abstract class Command {
	/**
	 * The client this command belongs to.
	 */

	public client = client;

	/**
	 * Prisma client instance.
	 */

	public prisma = prisma;

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

export type CommandOptions = {
	name: string;
	aliases?: string[];
	description: string;
	flags?: FlagsArray;
};

type FlagsArray = { keys: string[]; acceptsValue: boolean }[];
