import {
	Events,
	type User,
	type Message,
	type MessageReaction,
	type PartialMessage,
	type PartialMessageReaction
} from "discord.js";

import { ApplyOptions, EventListener } from "#rhenium";

import QuickActionUtils from "#utils/QuickActions.js";
import ConfigManager from "#root/lib/config/ConfigManager.js";

@ApplyOptions<EventListener.Options>({
	event: Events.MessageReactionAdd
})
export default class MessageReactionAdd extends EventListener {
	public async onEmit(rec: MessageReaction, user: User) {
		const [reaction, message] = await MessageReactionAdd._parseProps(rec, rec.message);
		if (!reaction || !message || !message.inGuild()) return;

		const config = await ConfigManager.get(message.guild.id);

		void Promise.all([
			QuickActionUtils.handleQuickMute({ user, message, reaction, config }),
			QuickActionUtils.handleQuickPurge({ user, message, reaction, config })
		]);
	}

	private static async _parseProps(
		reaction: PartialMessageReaction | MessageReaction,
		message: PartialMessage | Message
	): Promise<readonly [MessageReaction | null, Message | null]> {
		const parsedReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
		const parsedMessage = message.partial ? await message.fetch().catch(() => null) : message;

		return [parsedReaction, parsedMessage] as const;
	}
}
