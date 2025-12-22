import { Colors, Events, Message, MessageReplyOptions, PermissionFlagsBits } from "discord.js";

import { reply } from "#utils/Messages.js";
import { RedisCache } from "#utils/Redis.js";
import { EventListener } from "#classes/EventListener.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";
import { captureException } from "@sentry/node";
import { MessageReplyData } from "#utils/Types.js";
import { Command, CommandManager } from "#classes/Command.js";

import Args from "#classes/Args.js";
import Logger from "#utils/Logger.js";

export default class MessageCreate extends EventListener {
	constructor() {
		super(Events.MessageCreate);
	}

	override async onEmit(message: Message<true>) {
		const prefix = await this._getPrefix(message);

		if (!prefix) return;
		if (!(await MessageCreate._checkWhitelist(message))) return;

		const trimmedContent = message.content.slice(prefix.length).trim();
		const spaceIndex = trimmedContent.indexOf(" ");

		const commandName = spaceIndex === -1 ? trimmedContent : trimmedContent.slice(0, spaceIndex);
		const command = CommandManager.get(commandName);

		if (!command || !command.messageRun) return;

		const parameters = spaceIndex === -1 ? "" : trimmedContent.substring(spaceIndex + 1).trim();
		const args = command.getArgsClass(message, parameters);

		try {
			await MessageCreate._handle(message, command, args);
		} catch (error) {
			const sentryId = captureException(error, {
				user: {
					id: message.author.id,
					username: message.author.username
				},
				extra: {
					channelId: message.channel.id,
					guildId: message.guild.id,
					messageId: message.id,
					command: command.name,
					messageContent: message.content
				}
			});

			await reply(message, {
				content: `An error occurred while executing this command (\`${sentryId}\`).`
			});

			return Logger.error("Error handling message command:", error);
		}
	}

	private static async _handle(message: Message<true>, command: Command, args: Args) {
		const response: MessageReplyData | null = await command.messageRun!(message, args);

		// Manually handled response.
		if (response === null) return;

		const error = response.error;
		delete response.error;

		const defaultOptions: MessageReplyOptions = {
			allowedMentions: { parse: [] }
		};

		const replyOptions = error
			? {
					...response,
					embeds: [{ description: error, color: Colors.Red }, ...(response.embeds ?? [])]
				}
			: response;

		await reply(message, { ...defaultOptions, ...replyOptions });
	}

	private async _getPrefix(message: Message<true>): Promise<string | null> {
		if (message.author.bot || message.webhookId) {
			return null;
		}

		const bot = await message.guild.members.fetchMe();
		const permissions = message.channel.permissionsFor(bot);

		if (!permissions.has(PermissionFlagsBits.SendMessages)) {
			return null;
		}

		return process.env.DEFAULT_PREFIX ?? ".";
	}

	private static async _checkWhitelist(message: Message<true>): Promise<boolean> {
		if (DEVELOPER_IDS.includes(message.author.id)) {
			return true;
		}

		const whitelisted = await RedisCache.guildIsWhitelisted(message.guild.id);

		if (!whitelisted) {
			await message.reply({
				content: "This guild is not whitelisted to use the bot."
			});
		}

		return whitelisted;
	}
}
