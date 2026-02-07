import { Result } from "@sapphire/result";
import { Events, Message } from "discord.js";
import { captureException } from "@sentry/node";

import { reply } from "#utils/Messages.js";
import { getWhitelistStatus } from "#utils/index.js";

import Logger from "#utils/Logger.js";
import Highlights from "#root/commands/Highlights.js";
import GuildConfig from "#config/GuildConfig.js";
import GlobalConfig from "#config/GlobalConfig.js";
import ConfigManager from "#config/ConfigManager.js";
import EventListener from "#events/EventListener.js";
import MessageManager from "#database/Messages.js";
import CommandManager from "#commands/CommandManager.js";
import AutomatedScanner from "#cf/AutomatedScanner.js";
import HeuristicScanner from "#cf/HeuristicScanner.js";

export default class MessageCreate extends EventListener {
	constructor() {
		super(Events.MessageCreate);
	}

	async execute(message: Message<true>): Promise<void> {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author.bot || message.webhookId || message.system) return;

		const whitelisted = await getWhitelistStatus(message.guild.id);
		const config = await ConfigManager.get(message.guild.id);
		const contentFilterConfig = config.parseContentFilterConfig();

		if (!whitelisted && !GlobalConfig.isDeveloper(message.author.id)) return;

		if (contentFilterConfig) {
			const serializedMessage = MessageManager.serialize(message);

			void Promise.all([
				AutomatedScanner.enqueueForScan(
					message,
					contentFilterConfig,
					serializedMessage
				),

				HeuristicScanner.triggerScan(message, contentFilterConfig)
			]);
		}

		void Promise.all([
			MessageCreate._handleCommand(message, config),
			MessageManager.queue(message),
			Highlights.highlightMessage(message)
		]);
	}

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
