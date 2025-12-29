import { ActionRowBuilder, ButtonBuilder, ButtonStyle, codeBlock, Message } from "discord.js";

import ms from "ms";
import util from "node:util";

import { Command } from "#classes/Command.js";
import { hastebin } from "#utils/index.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";

import type { MessageReplyData } from "#utils/Types.js";

import Args from "#classes/Args.js";

export default class Eval extends Command {
	public constructor() {
		super({
			name: "eval",
			aliases: ["evaluate", "execute", "run", "ev", "e"],
			description: "Evaluate arbitrary JavaScript code.",
			flags: [
				{ keys: ["depth", "d"], acceptsValue: true },
				{ keys: ["async", "a"], acceptsValue: false },
				{ keys: ["silent", "s"], acceptsValue: false }
			]
		});
	}

	public async messageRun(message: Message<true>, args: Args): Promise<MessageReplyData | null> {
		if (!DEVELOPER_IDS.includes(message.author.id)) {
			return null;
		}

		if (args.finished) {
			return { error: `You must provide a string of code to evaluate.` };
		}

		const code = args.restString() as string;
		const rawDepth = args.getOption("depth", "d");
		const isAsync = args.getFlags("async", "a");
		const isSilent = args.getFlags("silent", "s");

		const depth = rawDepth ? parseInt(rawDepth) : 0;

		let rawOutput;
		let error = false;

		const start = performance.now();

		try {
			rawOutput = await eval(isAsync ? `(async () => { ${code} })()` : code);
		} catch (_) {
			rawOutput = _;
			error = true;
		}

		if (isSilent) {
			return null;
		}

		const timeTaken = performance.now() - start;
		const type = typeof rawOutput;

		const output = typeof rawOutput === "string" ? rawOutput : util.inspect(rawOutput, { depth });
		const content = error
			? `**Error**\n${codeBlock("ts", output)}\n**Time Taken:** \`${Eval._formatTime(timeTaken)}\``
			: `**Output**\n${codeBlock(
					"ts",
					output
				)}\n**Return Type:** \`${type}\`\n**Time Taken:** \`${Eval._formatTime(timeTaken)}\``;

		if (output.length > 1900) {
			const dataUrl = (await hastebin(output, "js")) as string;
			const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("View Output").setURL(dataUrl);
			const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

			return {
				content: `**Return Type:** \`${error ? `error` : type}\`\n**Time Taken:** \`${Eval._formatTime(
					timeTaken
				)}\``,
				components: [actionRow]
			};
		}

		return { content };
	}

	/**
	 * Format time taken in a human-readable format.
	 *
	 * @param timeTaken Time taken in milliseconds.
	 * @returns Formatted time string.
	 */

	private static _formatTime(timeTaken: number): string {
		return timeTaken < 1
			? `${Math.round(timeTaken / 1e-2)} microseconds`
			: ms(Math.round(timeTaken), { long: true });
	}
}
