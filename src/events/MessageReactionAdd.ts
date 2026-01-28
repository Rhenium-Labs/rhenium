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
	public async onEmit(addedReaction: MessageReaction, user: User) {
		const reaction = await MessageReactionAdd._parseReaction(addedReaction);
		if (!reaction) return;

		const message = await MessageReactionAdd._parseMessage(reaction.message);
		if (!message || !message.inGuild()) return;

		const config = await ConfigManager.get(message.guild.id);

		void Promise.all([
			QuickActionUtils.handleQuickMute({ user, message, reaction, config }),
			QuickActionUtils.handleQuickPurge({ user, message, reaction, config })
		]);
	}

	private static async _parseReaction(
		reaction: PartialMessageReaction | MessageReaction
	): Promise<MessageReaction | null> {
		if (reaction.partial) {
			return reaction.fetch().catch(() => null);
		}

		return Promise.resolve(reaction);
	}

	private static async _parseMessage(message: PartialMessage | Message): Promise<Message | null> {
		if (message.partial) {
			return message.fetch().catch(() => null);
		}

		return Promise.resolve(message);
	}
}
