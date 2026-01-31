import { Events, type PartialMessage } from "discord.js";
import { ApplyOptions, EventListener } from "#rhenium";

import Messages from "#utils/Messages.js";

@ApplyOptions<EventListener.Options>({
	event: Events.MessageDelete
})
export default class MessageDelete extends EventListener {
	public async onEmit(message: PartialMessage<true>): Promise<any> {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author?.bot || message.webhookId || message.system) return;
		// Skip if this message is being handled by a purge action.
		if (Messages.purgeExclusions.has(message.id)) return;

		return Messages.delete(message.id);
	}
}
