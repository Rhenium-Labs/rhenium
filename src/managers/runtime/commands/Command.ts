import { ArgumentStream, IUnorderedStrategy, Lexer, Parser } from "@sapphire/lexure";
import FlagStrategy from "./FlagOptionStrategy";
import {
	ApplicationCommandData,
	Awaitable,
	ChatInputCommandInteraction,
	InteractionReplyOptions,
	Message,
	MessageContextMenuCommandInteraction,
	MessageCreateOptions,
	UserContextMenuCommandInteraction
} from "discord.js";
import ArgumentParser from "./ArgumentParser";
import GuildConfig from "@config/GuildConfig";
import { client, kysely } from "@root/index";

export default abstract class Command {
	/**
	 * The client this command is associated with.
	 */

	readonly client = client;

	/**
	 * Kysely client instance.
	 */

	readonly kysely = kysely;

	/**
	 * The name of the command.
	 */

	readonly name: string;

	/**
	 * The aliases of the command.
	 */
	readonly aliases: string[];

	/**
	 * The description of the command.
	 */

	readonly description: string;

	/**
	 * The category of the command.
	 */

	readonly category: CommandCategory;

	/**
	 * The lexer of the command.
	 */

	private readonly _lexer: Lexer;

	/**
	 * The strategy to use for the parser.
	 */

	private readonly _strategy: IUnorderedStrategy;

	/**
	 * Constructs a new command.
	 *
	 * @param options The command options.
	 * @returns The constructed command.
	 */

	protected constructor(options: CommandOptions) {
		const { name, description, category, flags, aliases } = options;

		this.name = name;
		this.aliases = aliases ?? [];
		this.description = description;
		this.category = category;

		this._lexer = new Lexer({ quotes: [] });
		this._strategy = new FlagStrategy(Command._getStrategyOptions(flags ?? []));
	}

	/**
	 * Method to execute when the command is invoked via a message.
	 * This should be implemented by subclasses to define command behavior.
	 *
	 * @param context The command execution context.
	 * @returns The response data for the command execution.
	 */

	executeMessage?(
		context: CommandExecutionContext<"message">
	): Awaitable<ResponseData<"message"> | null>;

	/**
	 * Method to execute when the command is invoked via an interaction.
	 * This should be implemented by subclasses to define command behavior.
	 *
	 * @param context The command execution context.
	 * @returns The response data for the command execution.
	 */

	executeInteraction?(
		context: CommandExecutionContext<"chatInputCmd" | "userCtxMenu" | "messageCtxMenu">
	): Awaitable<ResponseData<"interaction"> | null>;

	/**
	 * Register function to provide application command data for Discord.
	 * This should be implemented by subclasses if the command is to be registered as an application command.
	 */

	register?(): ApplicationCommandData;

	/**
	 * Constructs an argument parser for the command.
	 *
	 * @param message The message that triggered the command.
	 * @param parameters The parameters passed to the command.
	 * @returns The argument parser.
	 */

	constructArgumentParser(message: Message<true>, parameters: string): ArgumentParser {
		const parser = new Parser(this._strategy);
		const stream = new ArgumentStream(parser.run(this._lexer.run(parameters)));
		return new ArgumentParser(message, stream);
	}

	/**
	 * Parses the flags array passed to the command and returns the flags and options.
	 *
	 * @param flags The flags to parse.
	 * @returns An object containing the flags and options.
	 */

	private static _getStrategyOptions(flags: CommandFlagOption[]): {
		flags: string[];
		options: string[];
	} {
		return flags.reduce<{ flags: string[]; options: string[] }>(
			(acc, flag) => {
				const destination = flag.isOption ? acc.options : acc.flags;
				destination.push(...flag.keys);
				return acc;
			},
			{ flags: [], options: [] }
		);
	}
}

export interface CommandOptions {
	name: string;
	aliases?: string[];
	description: string;
	category: CommandCategory;
	flags?: CommandFlagOption[];
}

export interface CommandFlagOption {
	keys: string[];
	isOption: boolean;
}

export enum CommandCategory {
	Management = "Management",
	Moderation = "Moderation",
	Developer = "Developer",
	Utility = "Utility"
}

export type CommandExecutionContext<
	T extends "message" | "chatInputCmd" | "userCtxMenu" | "messageCtxMenu"
> = {
	config: GuildConfig;
} & (T extends "message"
	? { message: Message<true>; args: ArgumentParser }
	: T extends "chatInputCmd"
		? { interaction: ChatInputCommandInteraction<"cached"> }
		: T extends "userCtxMenu"
			? { interaction: UserContextMenuCommandInteraction<"cached"> }
			: T extends "messageCtxMenu"
				? { interaction: MessageContextMenuCommandInteraction<"cached"> }
				: never);

export type ResponseData<T extends "message" | "interaction"> = {
	temporary?: boolean;
	error?: string;
} & (T extends "message" ? MessageCreateOptions : Omit<InteractionReplyOptions, "ephemeral">);
