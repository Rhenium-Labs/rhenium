import { Events, type Message, type PartialMessage } from "discord.js";

import Messages from "#utils/Messages.js";
import EventListener from "#managers/events/EventListener.js";

export default class MessageUpdate extends EventListener {
	constructor() {
		super(Events.MessageUpdate);
	}

	execute(_: PartialMessage<true>, newMessage: Message<true>): void {
		// Ignore bot messages, webhooks, and system messages.
		if (newMessage.author.bot || newMessage.webhookId || newMessage.system) return;
		// Ignore empty updates.
		if (!newMessage.content) return;

		const updatedContent = Messages.cleanContent(newMessage.content, newMessage.channel);
		void Messages.update(newMessage.id, updatedContent);
	}
}
