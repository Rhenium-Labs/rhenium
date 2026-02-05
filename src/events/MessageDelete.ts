import { Events, type PartialMessage } from "discord.js";

import Messages from "#utils/Messages.js";
import EventListener from "#managers/events/EventListener.js";

export default class MessageDelete extends EventListener {
	constructor() {
		super(Events.MessageDelete);
	}

	execute(message: PartialMessage<true>): void {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author?.bot || message.webhookId || message.system) return;
		// Skip if this message is being handled by a purge action.
		if (Messages.purgeExclusions.has(message.id)) return;

		void Messages.delete(message.id);
	}
}
