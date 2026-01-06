import { Events } from "discord.js";
import { MessageQueue } from "#utils/Messages.js";

import Logger from "#utils/Logger.js";
import EventListener from "#managers/events/EventListener.js";

export default class Ready extends EventListener {
	public constructor() {
		super(Events.ClientReady, true);
	}

	public async onEmit(): Promise<void> {
		Logger.success(`Logged in as ${this.client.user?.tag}!`);
		setInterval(async () => {
			await MessageQueue.store().catch(error => {
				Logger.error("Failed to store messages.", error);
			});
		}, 3600000); // 1 hour
	}
}
