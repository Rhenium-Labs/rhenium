import { Result } from "@sapphire/result";
import { ArgumentStream, join, WordParameter } from "@sapphire/lexure";
import { SnowflakeRegex, UserOrMemberMentionRegex } from "@sapphire/discord-utilities";
import type { GuildMember, Message, Snowflake, User } from "discord.js";

export default class ArgumentParser {
	/**
	 * The message that triggered the parser.
	 */

	private _message: Message<true>;

	/**
	 * Internal argument parser.
	 */

	private _parser: ArgumentStream;

	/**
	 * Constructs a new Args instance.
	 *
	 * @param message The message that triggered the parser.
	 * @param parser The argument parser to use for this class.
	 * @returns A new Args instance.
	 */

	public constructor(message: Message<true>, parser: ArgumentStream) {
		this._message = message;
		this._parser = parser;
	}

	/**
	 * Whether all the arguments have been consumed.
	 */

	public get finished(): boolean {
		return this._parser?.finished ?? true;
	}

	/**
	 * Retrieves a member from the available arguments.
	 */

	public async getMember(): Promise<GuildMember | null> {
		if (this._parser.finished) {
			return null;
		}

		return this._parser
			.singleParseAsync<GuildMember | null, null>(async parameter => {
				const memberId =
					UserOrMemberMentionRegex.exec(parameter) ?? SnowflakeRegex.exec(parameter);
				const member = memberId
					? await this._message.guild.members
							.fetch(memberId[1] as Snowflake)
							.catch(() => null)
					: null;

				return Result.ok(member);
			})
			.then(result => result.unwrap());
	}

	/**
	 * Retrieves a user from the available arguments.
	 */

	public async getUser(): Promise<User | null> {
		if (this._parser.finished) {
			return null;
		}

		return this._parser
			.singleParseAsync<User | null, null>(async parameter => {
				const userId =
					UserOrMemberMentionRegex.exec(parameter) ?? SnowflakeRegex.exec(parameter);
				const user = userId
					? await this._message.client.users
							.fetch(userId[1] as Snowflake)
							.catch(() => null)
					: null;

				return Result.ok(user);
			})
			.then(result => result.unwrap());
	}

	/**
	 * Retrieves a string from the available arguments.
	 */

	public getString(): string | null {
		return this._parser.finished
			? null
			: this._parser
					.singleParse<string | null, null>(parameter => {
						return Result.ok(parameter);
					})
					.unwrap();
	}

	/**
	 * Retrieves a number from the available arguments.
	 *
	 * @param min The minimum number to return. If not provided, no minimum is enforced.
	 * @param max The maximum number to return. If not provided, no maximum is enforced.
	 */

	public getNumber(min?: number, max?: number): number | null {
		if (this._parser.finished) {
			return null;
		}

		return this._parser
			.singleParse<number | null, null>(parameter => {
				const number = Number(parameter);

				if (Number.isNaN(number)) {
					return Result.ok(null);
				}

				// Clamp the number between min and max if provided
				const clampedNumber = Math.min(
					max ?? Infinity,
					Math.max(min ?? -Infinity, number)
				);
				return Result.ok(clampedNumber);
			})
			.unwrap();
	}

	/**
	 * Retrieves a boolean from the available arguments.
	 */
	public getBoolean(): boolean | null {
		if (this._parser.finished) {
			return null;
		}

		const trueValues = ["true", "yes", "y", "on", "enable", "enabled", "positive"];
		const falseValues = ["false", "no", "n", "off", "disable", "disabled", "negative"];

		return this._parser
			.singleParse<boolean | null, null>(parameter => {
				const value = parameter.trim().toLowerCase();

				if (trueValues.includes(value)) return Result.ok(true);
				if (falseValues.includes(value)) return Result.ok(false);

				return Result.ok(null);
			})
			.unwrap();
	}

	/**
	 * Retrieves all of the remaining arguments as a single string.
	 */

	public restString(): string | null {
		if (this._parser.finished) {
			return null;
		}

		this._parser.save();
		const str = join(this._parser.many().unwrapOr<WordParameter[]>([]));

		return str;
	}

	/**
     * Retrieves the last value of one or more options.

     * @param keys The name(s) of the option.
     */
	public getOption(...keys: readonly string[]): string | null {
		return this._parser.option(...keys).unwrapOr(null) || null;
	}

	/**
	 * Checks if one or more flag were given.
	 *
	 * @param keys The name(s) of the flag.
	 */
	public getFlags(...keys: readonly string[]): boolean {
		return this._parser.flag(...keys) ?? false;
	}
}
