import { AliasPiece } from "@sapphire/pieces";
import { ArgumentStream, type IUnorderedStrategy, Lexer, Parser } from "@sapphire/lexure";
import type {
	ApplicationCommandData,
	Awaitable,
	ChatInputCommandInteraction,
	CommandInteraction,
	Message as DjsMessage,
	MessageContextMenuCommandInteraction,
	UserContextMenuCommandInteraction
} from "discord.js";

import { client, kysely } from "#root/index.js";
import type { InteractionReplyData, MessageReplyData } from "#utils/Types.js";

import GuildConfig from "#config/GuildConfig.js";
import FlagStrategy from "./FlagStrategy.js";
import ArgumentParser from "./ArgumentParser.js";

export abstract class Command<Options extends Command.Options = Command.Options> extends AliasPiece<
	Options,
	"commands"
> {
	/**
	 * The client this command belongs to.
	 */

	public client = client;

	/**
	 * Kysely client instance.
	 */

	public kysely = kysely;

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
	 * @param context The command context.
	 * @param options The command options.
	 * @return The constructed command instance.
	 */

	public constructor(context: AliasPiece.LoaderContext<"commands">, options: Options = {} as Options) {
		const name = options.name ?? context.name;
		super(context, { ...options, name });

		this.description = options.description;
		this.lexer = new Lexer({ quotes: [] });
		this.strategy = new FlagStrategy(Command._getStrategyOptions(options.flags ?? []));
	}

	/**
	 * Get the argument handler for the command.
	 * This is used to parse the arguments passed to the command.
	 *
	 * @param message The message that triggered the command.
	 * @param parameters The parameters passed to the command.
	 */

	public getArgumentParser(message: DjsMessage<true>, parameters: string): ArgumentParser {
		const parser = new Parser(this.strategy);
		const stream = new ArgumentStream(parser.run(this.lexer.run(parameters)));
		return new ArgumentParser(message, stream);
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
	 * @param config The guild configuration.
	 * @return The result of the command execution.
	 */

	public interactionRun?(
		interaction: CommandInteraction<"cached">,
		config: GuildConfig
	): Awaitable<InteractionReplyData | null>;

	/**
	 * Handles message based command execution.
	 *
	 * @param message The message that triggered the command.
	 * @param args The argument parser instance.
	 * @param config The guild configuration.
	 * @return The result of the command execution.
	 */

	public messageRun?(
		message: DjsMessage<true>,
		args: ArgumentParser,
		config: GuildConfig
	): Awaitable<MessageReplyData | null>;

	/**
	 * Parses the flags array passed to the command and returns the flags and options.
	 *
	 * @param flags The flags to parse.
	 * @returns An object containing the flags and options.
	 */

	private static _getStrategyOptions(flags: CommandFlag[]): { flags: string[]; options: string[] } {
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

/** Options for constructing a Command instance. */
interface CommandOptions extends AliasPiece.Options {
	name: string;
	description: string;
	flags?: CommandFlag[];
}

/** Represents a command flag or option. */
interface CommandFlag {
	keys: string[];
	acceptsValue: boolean;
}

type InteractionGeneric = "chatInput" | "messageContextMenu" | "userContextMenu";

export namespace Command {
	export type Data = ApplicationCommandData;
	export type Options = CommandOptions;
	export type Args = ArgumentParser;
	export type Message = DjsMessage<true>;
	export type Interaction<T extends InteractionGeneric = InteractionGeneric> = T extends "chatInput"
		? ChatInputCommandInteraction<"cached">
		: T extends "messageContextMenu"
			? MessageContextMenuCommandInteraction<"cached">
			: UserContextMenuCommandInteraction<"cached">;
}
