import { Events, type Message, type PartialMessage } from "discord.js";
import { cleanMessageContent, MessageQueue } from "#utils/Messages.js";

import EventListener from "#managers/events/EventListener.js";

export default class MessageUpdate extends EventListener {
	public constructor() {
		super(Events.MessageUpdate);
	}

	public async onEmit(_: PartialMessage<true>, newMessage: Message<true>): Promise<any> {
		// Ignore bot messages, webhooks, and system messages.
		if (newMessage.author.bot || newMessage.webhookId || newMessage.system) return;
		// Ignore empty updates.
		if (!newMessage.content) return;

		const updatedContent = cleanMessageContent(newMessage.content, newMessage.channel);
		return MessageQueue.updateMessage(newMessage.id, updatedContent);
	}
}
