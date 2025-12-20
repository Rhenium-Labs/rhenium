import { Events } from "discord.js";
import { EventListener } from "#classes/EventListener.js";

import Logger from "#utils/Logger.js";

export default class Ready extends EventListener {
	public constructor() {
		super(Events.ClientReady, true);
	}

	public onEmit(): void {
		return Logger.success(`Logged in as ${this.client.user?.tag}!`);
	}
}
