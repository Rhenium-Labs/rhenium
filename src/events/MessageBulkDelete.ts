import { Events, type Collection, type PartialMessage, type Snowflake } from "discord.js";

import Messages from "#utils/Messages.js";
import EventListener from "#managers/runtime/events/EventListener.js";

export default class MessageBulkDelete extends EventListener {
	constructor() {
		super(Events.MessageBulkDelete);
	}

	execute(deletedMessages: Collection<Snowflake, PartialMessage<true>>): void {
		const messageIds = deletedMessages
			.filter(message => !(message.author?.bot || message.webhookId || message.system))
			.map(message => message.id);

		if (messageIds.length === 0) return;
		// Skip if any of these messages are being handled by a purge action.
		if (messageIds.some(id => Messages.purgeExclusions.has(id))) return;

		void Messages.bulkDelete(messageIds);
	}
}
