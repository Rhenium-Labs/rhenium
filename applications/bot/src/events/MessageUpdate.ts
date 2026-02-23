import { Events, type Message, type PartialMessage } from "discord.js";
import { cleanContent } from "@utils/Messages";

import EventListener from "@events/EventListener";
import MessageManager from "@database/Messages";

export default class MessageUpdate extends EventListener {
	constructor() {
		super(Events.MessageUpdate);
	}

	execute(_: PartialMessage<true>, newMessage: Message<true>): void {
		// Ignore bot messages, webhooks, and system messages.
		if (newMessage.author.bot || newMessage.webhookId || newMessage.system) return;
		// Ignore empty updates.
		if (!newMessage.content) return;

		const updatedContent = cleanContent(newMessage.content, newMessage.channel);
		MessageManager.updateContent(newMessage.id, updatedContent);
	}
}
