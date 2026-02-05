import { Events } from "discord.js";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#config/GlobalConfig.js";
import EventListener from "#managers/events/EventListener.js";
import AutomatedScanner from "#cf/AutomatedScanner.js";
import HeuristicScanner from "#cf/HeuristicScanner.js";

export default class Ready extends EventListener {
	constructor() {
		super(Events.ClientReady);
	}

	execute(): void {
		Logger.success(`Logged in as ${this.client.user?.tag}!`);

		void Promise.all([
			AutomatedScanner.startTickLoop(),
			HeuristicScanner.startCleanupInterval(),
			GlobalConfig.startMessageReportDisregardCronJob(),
			GlobalConfig.startMessageRetentionCronJobs()
		]);
	}
}
