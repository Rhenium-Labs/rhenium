import {
	Events,
	type User,
	type Message,
	type MessageReaction,
	type PartialMessage,
	type PartialMessageReaction
} from "discord.js";

import QuickActionUtils from "#utils/QuickActions.js";
import EventListener from "#managers/events/EventListener.js";
import ConfigManager from "#managers/config/ConfigManager.js";

export default class MessageReactionAdd extends EventListener {
	public constructor() {
		super(Events.MessageReactionAdd);
	}

	public async onEmit(addedReaction: MessageReaction, user: User) {
		const reaction = await MessageReactionAdd._parseReaction(addedReaction);
		if (!reaction) return;

		const message = await MessageReactionAdd._parseMessage(reaction.message);
		if (!message || !message.inGuild()) return;

		const config = await ConfigManager.getGuildConfig(message.guild.id);

		return Promise.all([
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
