import { Events } from "discord.js";

import Logger from "@utils/Logger";
import GlobalConfig from "@config/GlobalConfig";
import EventListener from "@events/EventListener";
import AutomatedScanner from "@cf/AutomatedScanner";
import HeuristicScanner from "@cf/HeuristicScanner";

export default class Ready extends EventListener {
	constructor() {
		super(Events.ClientReady);
	}

	execute(): void {
		Logger.success(`Logged in as ${this.client.user?.tag}!`);

		Promise.all([
			AutomatedScanner.startTickLoop(),
			HeuristicScanner.startCleanupInterval(),
			GlobalConfig.startMessageReportDisregardCronJob(),
			GlobalConfig.startMessageRetentionCronJobs()
		]);
	}
}
