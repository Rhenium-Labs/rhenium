import { Events, type Collection, type PartialMessage, type Snowflake } from "discord.js";
import { ApplyOptions, EventListener } from "#rhenium";

import Messages from "#utils/Messages.js";

@ApplyOptions<EventListener.Options>({
	event: Events.MessageBulkDelete
})
export default class MessageBulkDelete extends EventListener {
	public async onEmit(
		deletedMessages: Collection<Snowflake, PartialMessage<true>>
	): Promise<any> {
		const messageIds = deletedMessages
			.filter(message => !(message.author?.bot || message.webhookId || message.system))
			.map(message => message.id);

		if (messageIds.length === 0) return;
		// Skip if any of these messages are being handled by a purge action.
		if (messageIds.some(id => Messages.purgeExclusions.has(id))) return;

		return Messages.bulkDelete(messageIds);
	}
}
