import { Events, type PartialMessage } from "discord.js";

import EventListener from "#events/EventListener.js";
import MessageManager from "#database/Messages.js";

export default class MessageDelete extends EventListener {
	constructor() {
		super(Events.MessageDelete);
	}

	execute(message: PartialMessage<true>): void {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author?.bot || message.webhookId || message.system) return;
		// Skip if this message is being handled by a purge action.
		if (MessageManager.exclusions.has(message.id)) return;

		MessageManager.delete(message.id);
	}
}
