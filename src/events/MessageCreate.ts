import { type Message, Events } from "discord.js";

import { KvCache } from "#utils/KvCache.js";
import { MessageQueue } from "#utils/Messages.js";

import Highlights from "#root/commands/Highlights.js";
import GlobalConfig from "#managers/config/GlobalConfig.js";
import EventListener from "#managers/events/EventListener.js";
import CommandManager from "#managers/commands/CommandManager.js";

export default class MessageCreate extends EventListener {
	public constructor() {
		super(Events.MessageCreate);
	}

	public async onEmit(message: Message<true>) {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author.bot || message.webhookId || message.system) return;

		const whitelist = await KvCache.getWhitelistStatus(message.guild.id);

		if (!whitelist) {
			if (GlobalConfig.isDeveloper(message.author.id)) {
				return CommandManager.handleMessageCommand(message);
			}

			return;
		}

		return Promise.all([
			MessageQueue.queue(message),
			Highlights.highlightMessage(message),
			CommandManager.handleMessageCommand(message)
		]);
	}
}
