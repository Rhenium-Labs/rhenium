import { Events, type PartialMessage } from "discord.js";

import { MessageQueue } from "#utils/Messages.js";
import { ApplyOptions, EventListener } from "#rhenium";

@ApplyOptions<EventListener.Options>({
	event: Events.MessageDelete
})
export default class MessageDelete extends EventListener {
	public async onEmit(message: PartialMessage<true>): Promise<any> {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author?.bot || message.webhookId || message.system) return;
		// Skip if this message is being handled by a purge action.
		if (MessageQueue.purgeExclusions.has(message.id)) return;

		return MessageQueue.deleteMessage(message.id);
	}
}
