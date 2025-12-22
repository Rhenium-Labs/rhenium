import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, Colors, Message } from "discord.js";

import { Command } from "#classes/Command.js";
import { hastebin } from "#utils/index.js";
import { kv, prisma } from "#root/index.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";
import { MessageReplyData } from "#utils/Types.js";

import Args from "#classes/Args.js";

export default class Whitelist extends Command {
	public constructor() {
		super({
			name: "whitelist",
			aliases: ["wl"],
			description: "Manage the guild whitelists."
		});
	}

	public async messageRun(message: Message<true>, args: Args): Promise<MessageReplyData> {
		if (!DEVELOPER_IDS.includes(message.author.id)) {
			return {
				error: "You do not have permission to use this command."
			};
		}

		if (args.finished) {
			return {
				error: "You must specify a subcommand: create, delete, check, list."
			};
		}

		const rawSubcmd = args.getString() as string;
		const subcmd = rawSubcmd.toLowerCase() as WhitelistSubcommand;

		if (!Object.values(WhitelistSubcommand).includes(subcmd)) {
			return {
				error: `Invalid subcommand \`${rawSubcmd}\`. Valid subcommands are: create, delete, check, list.`
			};
		}

		// Typescript requires this extra line to narrow the type correctly,
		// even though the only command that doesn't accept a guild ID is "list".
		const guildId = args.getString() as string;

		if (!guildId && subcmd !== WhitelistSubcommand.List) {
			return {
				error: `You must provide the ID of a guild to ${subcmd} an entry for.`
			};
		}

		switch (subcmd) {
			case WhitelistSubcommand.Create: {
				const exists = await prisma.whitelist.findUnique({ where: { id: guildId } });

				if (exists) {
					return {
						error: `Guild with ID \`${guildId}\` is already whitelisted.`
					};
				}

				await prisma.whitelist.create({ data: { id: guildId } });
				await kv.set<boolean>(`whitelists:${guildId}`, true);

				return {
					embeds: [
						{
							description: `Successfully whitelisted guild with ID \`${guildId}\`.`,
							color: Colors.Green
						}
					]
				};
			}

			case WhitelistSubcommand.Delete: {
				const exists = await prisma.whitelist.findUnique({ where: { id: guildId } });

				if (!exists) {
					return {
						error: `Guild with ID \`${guildId}\` is not whitelisted.`
					};
				}

				await prisma.whitelist.delete({ where: { id: guildId } });
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

			case WhitelistSubcommand.Check: {
				const isWhitelisted = await prisma.whitelist.findUnique({ where: { id: guildId } });

				return {
					embeds: [
						{
							description: `Guild with ID \`${guildId}\` is ${isWhitelisted ? "" : "not"} whitelisted.`,
							color: isWhitelisted ? Colors.Green : Colors.Blue
						}
					]
				};
			}

			case WhitelistSubcommand.List: {
				const whitelists = await prisma.whitelist.findMany();

				if (!whitelists.length) {
					return {
						embeds: [
							{
								description: "There are no entries in the whitelist.",
								color: Colors.Blue
							}
						]
					};
				}

				const mapped = whitelists.map(entry => `- ${entry.id}`).join("\n");

				const buffer = Buffer.from(mapped, "utf-8");
				const attachment = new AttachmentBuilder(buffer, {
					name: "whitelist.txt"
				});
				const uploadUrl = await hastebin(mapped, "txt").catch(() => null);

				if (uploadUrl) {
					const button = new ButtonBuilder()
						.setLabel("Open In Browser")
						.setStyle(ButtonStyle.Link)
						.setURL(uploadUrl);

					const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

					return {
						content: `Below contains a list of each entry in the whitelist.`,
						files: [attachment],
						components: [actionRow]
					};
				}

				return {
					content: `Below contains a list of each entry in the whitelist.`,
					files: [attachment]
				};
			}
		}
	}
}

const WhitelistSubcommand = {
	Create: "create",
	Delete: "delete",
	Check: "check",
	List: "list"
} as const;
type WhitelistSubcommand = (typeof WhitelistSubcommand)[keyof typeof WhitelistSubcommand];
