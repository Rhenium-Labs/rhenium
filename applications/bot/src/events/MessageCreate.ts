import { Result } from "@sapphire/result";
import { Events, Message } from "discord.js";
import { captureException } from "@sentry/node";

import { reply } from "@utils/Messages";
import { getWhitelistStatus } from "@utils/index";

import Logger from "@utils/Logger";
import Highlights from "@root/commands/Highlights";
import GuildConfig from "@config/GuildConfig";
import GlobalConfig from "@config/GlobalConfig";
import ConfigManager from "@config/ConfigManager";
import EventListener from "@events/EventListener";
import MessageManager from "@database/Messages";
import CommandManager from "@commands/CommandManager";
import AutomatedScanner from "@cf/AutomatedScanner";
import HeuristicScanner from "@cf/HeuristicScanner";

export default class MessageCreate extends EventListener {
	constructor() {
		super(Events.MessageCreate);
	}

	async execute(message: Message<true>): Promise<unknown> {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author.bot || message.webhookId || message.system) return;

		const serializedMessage = MessageManager.serialize(message);
		const whitelisted = await getWhitelistStatus(message.guild.id);
		const config = await ConfigManager.getGuildConfig(message.guild.id);

		if (!whitelisted) {
			if (!GlobalConfig.isDeveloper(message.author.id)) return;
			// Developers can run commands regardless of whitelist status.
			return MessageCreate._handleCommand(message, config);
		}

		return Promise.all([
			Highlights.highlightMessage(message),
			AutomatedScanner.enqueueForScan(message, config, serializedMessage),
			HeuristicScanner.triggerScan(message, config),
			MessageManager.queue(message),
			MessageCreate._handleCommand(message, config)
		]);
	}

	/**
	 * Handles a message to check for command execution and other message-based features.
	 *
	 * @param message The message to handle.
	 * @param config The guild configuration for the message's guild.
	 * @returns A promise that resolves when the message handling is complete.
	 */

	private static async _handleCommand(
		message: Message<true>,
		config: GuildConfig
	): Promise<void> {
		const prefix = ".";
		const permissionsFor = message.channel.permissionsFor(message.guild.members.me!);

		if (
			!message.content.startsWith(prefix) ||
			!permissionsFor?.has(["SendMessages", "EmbedLinks"])
		)
			return;

		const trimmedContent = message.content.slice(prefix.length).trim();
		const spaceIdx = trimmedContent.indexOf(" ");

		const commandName = spaceIdx === -1 ? trimmedContent : trimmedContent.slice(0, spaceIdx);
		if (!commandName.length) return;

		const command = CommandManager.get(commandName);

		// Unlike interactions, we don't need to acknowledge "unknown" commands here.
		// They might be using a different prefix or just typing random text.
		if (!command) return;

		// We also don't need to acknowledge commands without a handler.
		// They're simply not meant to be used as message commands.
		if (!command.executeMessage) return;

		const parameters = spaceIdx === -1 ? "" : trimmedContent.substring(spaceIdx + 1).trim();
		const args = command.constructArgumentParser(message, parameters);

		const result = await Result.fromAsync(async () => {
			const response = await command.executeMessage!({ message, args, config });

			// The reply to the command was handled manually.
			if (!response) return;

			const { error, temporary, ...baseOptions } = response;

			const embeds = error
				? [{ description: error, color: 0xff0000 }, ...(baseOptions.embeds ?? [])]
				: baseOptions.embeds;

			const options = { ...baseOptions, embeds };
			const rep = await reply(message, options);

			if (error || temporary) {
				setTimeout(() => {
					message.delete().catch(() => {});
					rep.delete().catch(() => {});
				}, 7500);
			}
		});

		if (result.isErr()) {
			const error = result.unwrapErr();
			const sentryId = captureException(error, {
				user: {
					id: message.author.id,
					username: message.author.username
				},
				extra: {
					guildId: message.guild.id,
					messageId: message.id,
					commandName
				}
			});

			const content = `An error occurred while executing this command. Please use this ID when reporting the bug: \`${sentryId}\`.`;

			Result.fromAsync(() => reply(message, { content }));
			Logger.traceable(sentryId, `Error executing command "${command.name}":`, error);

			return;
		}
	}
}
