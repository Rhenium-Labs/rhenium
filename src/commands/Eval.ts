import { ActionRowBuilder, ButtonBuilder, ButtonStyle, codeBlock, type Message } from "discord.js";

import ms from "ms";
import util from "node:util";

import { hastebin } from "#utils/index.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";

import type { MessageReplyData } from "#utils/Types.js";

import Args from "#classes/Args.js";
import Command from "#classes/Command.js";

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
		if (!DEVELOPER_IDS.includes(message.author.id)) return null;

		if (args.finished) {
			return { error: "You must provide a string of code to evaluate." };
		}

		const code = args.restString()!;
		const depth = parseInt(args.getOption("depth", "d") ?? "0");
		const isAsync = args.getFlags("async", "a");
		const isSilent = args.getFlags("silent", "s");

		const start = performance.now();

		let rawOutput: unknown;
		let isError = false;

		try {
			rawOutput = await eval(isAsync ? `(async () => { ${code} })()` : code);
		} catch (error) {
			rawOutput = error;
			isError = true;
		}

		const timeTaken = performance.now() - start;
		const type = typeof rawOutput;
		const output = typeof rawOutput === "string" ? rawOutput : util.inspect(rawOutput, { depth });

		// If silent, do not send any response.
		if (isSilent) return null;

		if (output.length > 1900) {
			return this._buildLargeOutputResponse(output, isError, type, timeTaken);
		}

		const header = isError ? "**Error**" : "**Output**";
		const typeInfo = isError ? "" : `\n**Return Type:** \`${type}\``;
		const content = `${header}\n${codeBlock("ts", output)}${typeInfo}\n**Time Taken:** \`${formatExecutionTime(timeTaken)}\``;

		return { content };
	}

	private async _buildLargeOutputResponse(
		output: string,
		isError: boolean,
		type: string,
		timeTaken: number
	): Promise<MessageReplyData> {
		const dataUrl = await hastebin(output, "js");

		if (!dataUrl) {
			return { error: "Output too large and failed to upload to hastebin." };
		}

		const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("View Output").setURL(dataUrl);

		return {
			content: `**Return Type:** \`${isError ? "error" : type}\`\n**Time Taken:** \`${formatExecutionTime(timeTaken)}\``,
			components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)]
		};
	}
}

/** Formats execution time in a human-readable format. */
function formatExecutionTime(timeTaken: number): string {
	if (timeTaken < 1) {
		return `${Math.round(timeTaken / 1e-2)} microseconds`;
	}
	return ms(Math.round(timeTaken), { long: true });
}
