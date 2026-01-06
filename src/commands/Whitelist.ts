import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Colors, type Message } from "discord.js";

import { kv } from "#root/index.js";
import { hastebin } from "#utils/index.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";

import type { MessageReplyData } from "#utils/Types.js";

import Command from "#managers/commands/Command.js";
import ArgumentParser from "#managers/commands/ArgParser.js";

export default class Whitelist extends Command {
	public constructor() {
		super({
			name: "whitelist",
			aliases: ["wl"],
			description: "Manage the guild whitelists."
		});
	}

	public async messageRun(message: Message<true>, args: ArgumentParser): Promise<MessageReplyData> {
		if (!DEVELOPER_IDS.includes(message.author.id)) {
			return { error: "You do not have permission to use this command." };
		}

		if (args.finished) {
			return { error: "You must specify a subcommand: create, delete, check, list." };
		}

		const rawSubcmd = args.getString()!;
		const subcmd = rawSubcmd.toLowerCase() as Subcommand;

		if (!Object.values(Subcommand).includes(subcmd)) {
			return {
				error: `Invalid subcommand \`${rawSubcmd}\`. Valid subcommands are: create, delete, check, list.`
			};
		}

		// List doesn't require a guild ID.
		if (subcmd === Subcommand.List) {
			return this._listWhitelists();
		}

		const guildId = args.getString();

		if (!guildId) {
			return { error: `You must provide the ID of a guild to ${subcmd} an entry for.` };
		}

		const handlers: Record<Exclude<Subcommand, "list">, () => Promise<MessageReplyData>> = {
			[Subcommand.Create]: () => this._createWhitelist(guildId),
			[Subcommand.Delete]: () => this._deleteWhitelist(guildId),
			[Subcommand.Check]: () => this._checkWhitelist(guildId)
		};

		return handlers[subcmd]();
	}

	private async _createWhitelist(guildId: string): Promise<MessageReplyData> {
		const exists = await this.prisma.whitelist.findUnique({ where: { id: guildId } });

		if (exists) {
			return { error: `Guild with ID \`${guildId}\` is already whitelisted.` };
		}

		await this.prisma.whitelist.create({ data: { id: guildId } });
		await kv.set<boolean>(`whitelists:${guildId}`, true);

		return {
			embeds: [{ description: `Successfully whitelisted guild with ID \`${guildId}\`.`, color: Colors.Green }]
		};
	}

	private async _deleteWhitelist(guildId: string): Promise<MessageReplyData> {
		const exists = await this.prisma.whitelist.findUnique({ where: { id: guildId } });
		if (!exists) {
			return { error: `Guild with ID \`${guildId}\` is not whitelisted.` };
		}

		await this.prisma.whitelist.delete({ where: { id: guildId } });
		await kv.set<boolean>(`whitelists:${guildId}`, false);

		return {
			embeds: [
				{
					description: `Successfully removed guild with ID \`${guildId}\` from the whitelist.`,
					color: Colors.Green
				}
			]
		};
	}

	private async _checkWhitelist(guildId: string): Promise<MessageReplyData> {
		const isWhitelisted = await this.prisma.whitelist.findUnique({ where: { id: guildId } });

		return {
			embeds: [
				{
					description: `Guild with ID \`${guildId}\` is ${isWhitelisted ? "" : "not "}whitelisted.`,
					color: isWhitelisted ? Colors.Green : Colors.Blue
				}
			]
		};
	}

	private async _listWhitelists(): Promise<MessageReplyData> {
		const whitelists = await this.prisma.whitelist.findMany();

		if (whitelists.length === 0) {
			return {
				embeds: [{ description: "There are no entries in the whitelist.", color: Colors.Blue }]
			};
		}

		const content = whitelists.map(entry => `- ${entry.id}`).join("\n");
		const attachment = new AttachmentBuilder(Buffer.from(content, "utf-8"), { name: "whitelist.txt" });

		const uploadUrl = await hastebin(content, "txt").catch(() => null);

		if (uploadUrl) {
			const button = new ButtonBuilder()
				.setLabel("Open In Browser")
				.setStyle(ButtonStyle.Link)
				.setURL(uploadUrl);

			return {
				content: "Below contains a list of each entry in the whitelist.",
				files: [attachment],
				components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)]
			};
		}

		return {
			content: "Below contains a list of each entry in the whitelist.",
			files: [attachment]
		};
	}
}

const Subcommand = {
	Create: "create",
	Delete: "delete",
	Check: "check",
	List: "list"
} as const;
type Subcommand = (typeof Subcommand)[keyof typeof Subcommand];
