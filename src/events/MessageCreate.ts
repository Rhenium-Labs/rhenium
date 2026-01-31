import { type Message, Events } from "discord.js";

import { MessageQueue } from "#utils/Messages.js";
import { getWhitelistStatus } from "#utils/index.js";
import { ApplyOptions, EventListener } from "#rhenium";

import Highlights from "#root/commands/Highlights.js";
import GlobalConfig from "#root/lib/config/GlobalConfig.js";
import ConfigManager from "#root/lib/config/ConfigManager.js";
import AutomatedScanner from "#cf/AutomatedScanner.js";
import HeuristicScanner from "#cf/HeuristicScanner.js";

@ApplyOptions<EventListener.Options>({
	event: Events.MessageCreate
})
export default class MessageCreate extends EventListener {
	public async onEmit(message: Message<true>) {
		// Ignore bot messages, webhooks, and system messages.
		if (message.author.bot || message.webhookId || message.system) return;

		const store = this.client.stores.get("commands");
		const whitelisted = await getWhitelistStatus(message.guild.id);

		if (!whitelisted) {
			if (GlobalConfig.isDeveloper(message.author.id)) {
				return store.handleMessageCommand(message);
			}

			return;
		}

		const config = (await ConfigManager.get(message.guild.id)).getContentFilterConfig();

		if (config) {
			const serializedMessage = MessageQueue.serializeMessage(message);

			void Promise.all([
				AutomatedScanner.enqueueForScan(message, config, serializedMessage),
				HeuristicScanner.triggerScan(message, config)
			]);
		}

		void Promise.all([
			store.handleMessageCommand(message),
			MessageQueue.enqueue(message),
			Highlights.highlightMessage(message)
		]);
	}
}
