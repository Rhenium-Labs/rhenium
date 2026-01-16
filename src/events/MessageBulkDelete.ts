import { Events, type Collection, type PartialMessage, type Snowflake } from "discord.js";
import { MessageQueue } from "#utils/Messages.js";

import EventListener from "#managers/events/EventListener.js";

export default class MessageBulkDelete extends EventListener {
	public constructor() {
		super(Events.MessageBulkDelete);
	}

	public async onEmit(deletedMessages: Collection<Snowflake, PartialMessage<true>>): Promise<any> {
		const messageIds = deletedMessages
			.filter(message => !(message.author?.bot || message.webhookId || message.system))
			.map(message => message.id);

		if (messageIds.length === 0) return;
		// Skip if any of these messages are being handled by a purge action.
		if (messageIds.some(id => MessageQueue.purgeExclusions.has(id))) return;

		return MessageQueue.bulkDeleteMessages(messageIds);
	}
}
