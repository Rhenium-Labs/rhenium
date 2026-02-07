import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	Colors
} from "discord.js";

import { hastebin } from "#utils/index.js";
import { kv, kysely } from "#root/index.js";

import Command, {
	CommandCategory,
	type ResponseData,
	type CommandExecutionContext
} from "#commands/Command.js";

import GlobalConfig from "#config/GlobalConfig.js";

export default class Whitelist extends Command {
	constructor() {
		super({
			name: "whitelist",
			aliases: ["wl"],
			category: CommandCategory.Developer,
			description: "Manage the guild whitelists."
		});
	}

	override async executeMessage({
		message,
		args
	}: CommandExecutionContext<"message">): Promise<ResponseData<"message">> {
		if (!GlobalConfig.isDeveloper(message.author.id)) {
			return { error: "You do not have permission to use this command." };
		}

		if (args.finished) {
			return { error: "You must specify a subcommand: create, delete, check, list." };
		}

		const subcommand = args.getString()!.toLowerCase() as WhitelistSubcommand;

		if (!Object.values(WhitelistSubcommand).includes(subcommand)) {
			return {
				error: `Invalid subcommand \`${subcommand}\`. Valid subcommands are: create, delete, check, list.`
			};
		}

		// List doesn't require a guild ID.
		if (subcommand === WhitelistSubcommand.List) {
			return Whitelist._list();
		}

		const guildId = args.getString();

		if (!guildId) {
			return {
				error: `You must provide the ID of a guild to ${subcommand} an entry for.`
			};
		}

		switch (subcommand) {
			case WhitelistSubcommand.Create:
				return Whitelist._create(guildId);
			case WhitelistSubcommand.Delete:
				return Whitelist._delete(guildId);
			case WhitelistSubcommand.Check:
				return Whitelist._check(guildId);
		}
	}

	private static async _create(guildId: string): Promise<ResponseData<"message">> {
		// prettier-ignore
		const exists = await kysely
			.selectFrom("Whitelist")
			.selectAll()
			.where("id", "=", guildId)
			.executeTakeFirst();

		if (exists) {
			return { error: `Guild with ID \`${guildId}\` is already whitelisted.` };
		}

		await kysely.insertInto("Whitelist").values({ id: guildId }).execute();
		await kv.put(`whitelists:${guildId}`, { status: true });

		return {
			embeds: [
				{
					description: `Successfully whitelisted guild with ID \`${guildId}\`.`,
					color: Colors.Green
				}
			]
		};
	}

	private static async _delete(guildId: string): Promise<ResponseData<"message">> {
		// prettier-ignore
		const exists = await kysely
			.selectFrom("Whitelist")
			.selectAll()
			.where("id", "=", guildId)
			.executeTakeFirst();

		if (!exists) {
			return { error: `Guild with ID \`${guildId}\` is not whitelisted.` };
		}

		await kysely.deleteFrom("Whitelist").where("id", "=", guildId).execute();
		await kv.put(`whitelists:${guildId}`, { status: false });

		return {
			embeds: [
				{
					description: `Successfully removed guild with ID \`${guildId}\` from the whitelist.`,
					color: Colors.Green
				}
			]
		};
	}

	private static async _check(guildId: string): Promise<ResponseData<"message">> {
		const cacheEntry = kv.get(`whitelists:${guildId}`) as { status: boolean } | undefined;

		let isWhitelisted: boolean;

		if (cacheEntry !== undefined) {
			isWhitelisted = cacheEntry.status;
		} else {
			// Cache miss: fall back to the database and refresh the cache.
			// prettier-ignore
			const dbEntry = await kysely
				.selectFrom("Whitelist")
				.selectAll()
				.where("id", "=", guildId)
				.executeTakeFirst();

			isWhitelisted = !!dbEntry;
			await kv.put(`whitelists:${guildId}`, { status: isWhitelisted });
		}
		return {
			embeds: [
				{
					description: `Guild with ID \`${guildId}\` is ${isWhitelisted ? "" : "not "}whitelisted.`,
					color: isWhitelisted ? Colors.Green : Colors.Blue
				}
			]
		};
	}

	private static async _list(): Promise<ResponseData<"message">> {
		// prettier-ignore
		const whitelists = await kysely
			.selectFrom("Whitelist")
			.selectAll()
			.execute();

		if (whitelists.length === 0) {
			return {
				embeds: [
					{
						description: "There are no entries in the whitelist.",
						color: Colors.Blue
					}
				]
			};
		}

		const content = whitelists.map(entry => `- ${entry.id}`).join("\n");
		const attachment = new AttachmentBuilder(Buffer.from(content, "utf-8"), {
			name: "whitelist.txt"
		});

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

enum WhitelistSubcommand {
	Create = "create",
	Delete = "delete",
	Check = "check",
	List = "list"
}
