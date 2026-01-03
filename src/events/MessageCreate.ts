import { Colors, Events, Message, MessageReplyOptions, PermissionFlagsBits } from "discord.js";
import { captureException } from "@sentry/node";

import { MessageQueue, reply } from "#utils/Messages.js";
import { RedisCache } from "#utils/Redis.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";

import Args from "#classes/Args.js";
import Logger from "#utils/Logger.js";
import Command from "#classes/Command.js";
import Highlights from "#root/commands/Highlights.js";
import EventListener from "#classes/EventListener.js";
import CommandManager from "#managers/CommandManager.js";

export default class MessageCreate extends EventListener {
	public constructor() {
		super(Events.MessageCreate);
	}

	public async onEmit(message: Message<true>): Promise<any> {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author.bot || message.webhookId || message.system) return;

		// prettier-ignore
		return Promise.all([
			Highlights.highlightMessage(message), 
			MessageCreate._processCommand(message),
			MessageQueue.queue(message)
		]);
	}

	private static async _processCommand(message: Message<true>): Promise<void> {
		const prefix = await this._getPrefix(message);
		if (!prefix) return;

		const trimmedContent = message.content.slice(prefix.length).trim();
		const spaceIndex = trimmedContent.indexOf(" ");

		const commandName = spaceIndex === -1 ? trimmedContent : trimmedContent.slice(0, spaceIndex);

		if (!commandName.length) return;

		const command = CommandManager.get(commandName);

		// Skip if no command found or command doesn't support message execution.
		if (!command?.messageRun) return;
		if (!(await MessageCreate._checkWhitelist(message))) return;

		const parameters = spaceIndex === -1 ? "" : trimmedContent.substring(spaceIndex + 1).trim();
		const args = command.getArgsClass(message, parameters);

		try {
			await MessageCreate._executeCommand(message, command, args);
		} catch (error) {
			await MessageCreate._handleCommandError(message, command, error);
		}
	}

	/**
	 * Executes a message command and handles the response.
	 */
	private static async _executeCommand(message: Message<true>, command: Command, args: Args): Promise<void> {
		const response = await command.messageRun!(message, args);

		// Reply was handled manually.
		if (response === null) return;

		const { error, temporary, ...options } = response;
		const defaultOptions: MessageReplyOptions = { allowedMentions: { parse: [] } };

		const replyOptions = error
			? { ...options, embeds: [{ description: error, color: Colors.Red }, ...(options.embeds ?? [])] }
			: options;

		const msg = await reply(message, { ...defaultOptions, ...replyOptions }).catch(() => null);

		if (error || temporary) {
			setTimeout(() => msg?.delete().catch(() => {}), 7500);
		}
	}

	/**
	 * Handles errors that occur during command execution.
	 */
	private static async _handleCommandError(message: Message<true>, command: Command, error: unknown): Promise<void> {
		const sentryId = captureException(error, {
			user: { id: message.author.id, username: message.author.username },
			extra: {
				channelId: message.channel.id,
				guildId: message.guild.id,
				messageId: message.id,
				command: command.name,
				messageContent: message.content
			}
		});

		await reply(message, { content: `An error occurred while executing this command (\`${sentryId}\`).` });
		Logger.error("Error handling message command:", error);
	}

	/**
	 * Gets the command prefix for a message, if applicable.
	 */
	private static async _getPrefix(message: Message<true>): Promise<string | null> {
		const prefix = ".";

		if (!message.content.startsWith(prefix)) return null;

		const bot = await message.guild.members.fetchMe();
		const permissions = message.channel.permissionsFor(bot);

		if (!permissions.has(PermissionFlagsBits.SendMessages)) return null;
		return prefix;
	}

	/**
	 * Checks if the guild is whitelisted to use the bot.
	 */
	private static async _checkWhitelist(message: Message<true>): Promise<boolean> {
		if (DEVELOPER_IDS.includes(message.author.id)) return true;

		const isWhitelisted = await RedisCache.guildIsWhitelisted(message.guild.id);

		if (!isWhitelisted) {
			await message.reply({ content: "This guild is not whitelisted to use the bot." });
		}

		return isWhitelisted;
	}
}
