import { Events } from "discord.js";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#managers/config/GlobalConfig.js";
import EventListener from "#managers/events/EventListener.js";

export default class Ready extends EventListener {
	public constructor() {
		super(Events.ClientReady, true);
	}

	public async onEmit(): Promise<any> {
		Logger.success(`Logged in as ${this.client.user?.tag}!`);

		return Promise.all([
			GlobalConfig.startMessageReportDisregardCronJob(),
			GlobalConfig.startMessageRetentionCronJobs()
		]);
	}
}
