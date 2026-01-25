import { Option } from "@sapphire/result";
import { PrefixedStrategy } from "@sapphire/lexure";

const never = () => Option.none;
const always = () => true;

export default class FlagStrategy extends PrefixedStrategy {
	/**
	 * The flags that the strategy will parse.
	 */

	public readonly flags: readonly string[] | true;

	/**
	 * The options that the strategy will parse.
	 */

	public readonly options: readonly string[] | true;

	/**
	 * Constructs a new FlagStrategy instance.
	 *
	 * @param options The options for the flag strategy.
	 * @return A new FlagStrategy instance.
	 */

	public constructor({
		flags,
		options,
		prefixes = ["--", "-", "—"],
		separators = ["=", ":"]
	}: FlagStrategyOptions = {}) {
		super(prefixes, separators);

		this.flags = flags || [];
		this.options = options || [];

		if (this.flags === true) this.allowedFlag = always;
		else if (this.flags.length === 0) this.matchFlag = never;

		if (this.options === true) {
			this.allowedOption = always;
		} else if (this.options.length === 0) {
			this.matchOption = never;
		}
	}

	/**
	 * Checks if the provided flag string matches an allowed flag.
	 *
	 * @param s - The flag string to match.
	 * @returns An `Option<string>` containing the matched flag if allowed, or `Option.none` if not.
	 */
	public override matchFlag(s: string): Option<string> {
		const result = super.matchFlag(s);
		return result.isSomeAnd(value => this.allowedFlag(value)) ? result : Option.none;
	}

	/**
	 * Attempts to match the given string to an option.
	 * Returns the option if its key is allowed, otherwise returns none.
	 *
	 * @param s - The input string to match against available options.
	 * @returns An Option containing the matched key-value pair if allowed, or none.
	 */
	public override matchOption(s: string): Option<readonly [key: string, value: string]> {
		const result = super.matchOption(s);
		return result.isSomeAnd(option => this.allowedOption(option[0])) ? result : Option.none;
	}

	/**
	 * Checks if the provided flag string is included in the allowed flags.
	 *
	 * @param s - The flag string to check.
	 * @returns `true` if the flag is allowed, otherwise `false`.
	 */
	private allowedFlag(s: string) {
		return (this.flags as readonly string[]).includes(s);
	}

	/**
	 * Checks if the provided string is included in the allowed options.
	 *
	 * @param s - The string to check against the allowed options.
	 * @returns `true` if the string is an allowed option, otherwise `false`.
	 */
	private allowedOption(s: string) {
		return (this.options as readonly string[]).includes(s);
	}
}

type FlagStrategyOptions = {
	/**
	 * The flags to use for the strategy.
	 */

	flags?: readonly string[] | boolean;

	/**
	 * The options (flags with values) to use for the strategy.
	 */

	options?: readonly string[] | boolean;

	/**
	 * The prefixes for both flags and options.
	 * @default ['--', '-', '—']
	 */
	prefixes?: string[];

	/**
	 * The flag separators.
	 * @default ['=', ':']
	 */
	separators?: string[];
};
