import { type Message, Events } from "discord.js";

import { KvCache } from "#utils/KvCache.js";
import { MessageQueue } from "#utils/Messages.js";

import Highlights from "#root/commands/Highlights.js";
import GlobalConfig from "#managers/config/GlobalConfig.js";
import EventListener from "#managers/events/EventListener.js";
import ConfigManager from "#managers/config/ConfigManager.js";
import CommandManager from "#managers/commands/CommandManager.js";
import AutomatedScanner from "#cf/AutomatedScanner.js";
import HeuristicScanner from "#cf/HeuristicScanner.js";

export default class MessageCreate extends EventListener {
	public constructor() {
		super(Events.MessageCreate);
	}

	public async onEmit(message: Message<true>) {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author.bot || message.webhookId || message.system) return;

		// Queue messages regardless of whitelist status.
		MessageQueue.queue(message);

		const whitelist = await KvCache.getWhitelistStatus(message.guild.id);

		if (!whitelist) {
			if (GlobalConfig.isDeveloper(message.author.id)) {
				return CommandManager.handleMessageCommand(message);
			}

			return;
		}

		const config = await ConfigManager.getGuildConfig(message.guild.id);
		const serializedMessage = MessageQueue.serializeMessage(message);

		return Promise.all([
			Highlights.highlightMessage(message),
			CommandManager.handleMessageCommand(message),
			AutomatedScanner.enqueueForScan(message, config.data.content_filter, serializedMessage),
			HeuristicScanner.triggerScan(message, config.data.content_filter)
		]);
	}
}
