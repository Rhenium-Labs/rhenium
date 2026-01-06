import { type Message, Events } from "discord.js";

import { RedisCache } from "#utils/Redis.js";
import { MessageQueue } from "#utils/Messages.js";
import { DEVELOPER_IDS } from "#utils/Constants.js";

import Highlights from "#root/commands/Highlights.js";
import EventListener from "#managers/events/EventListener.js";
import CommandManager from "#managers/commands/CommandManager.js";

export default class MessageCreate extends EventListener {
	public constructor() {
		super(Events.MessageCreate);
	}

	public async onEmit(message: Message<true>): Promise<any> {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author.bot || message.webhookId || message.system) return;

		const whitelist = await RedisCache.guildIsWhitelisted(message.guild.id);

		if (!whitelist) {
			if (DEVELOPER_IDS.includes(message.author.id)) {
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
