import { Events, type Message, type PartialMessage } from "discord.js";
import { ApplyOptions, EventListener } from "#rhenium";

import Messages from "#utils/Messages.js";

@ApplyOptions<EventListener.Options>({
	event: Events.MessageUpdate
})
export default class MessageUpdate extends EventListener {
	public async onEmit(_: PartialMessage<true>, newMessage: Message<true>): Promise<any> {
		// Ignore bot messages, webhooks, and system messages.
		if (newMessage.author.bot || newMessage.webhookId || newMessage.system) return;
		// Ignore empty updates.
		if (!newMessage.content) return;

		const updatedContent = Messages.cleanContent(newMessage.content, newMessage.channel);
		return Messages.update(newMessage.id, updatedContent);
	}
}
