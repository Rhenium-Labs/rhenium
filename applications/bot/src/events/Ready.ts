import { Events, RESTEvents } from "discord.js";

import Logger from "@utils/Logger";
import GlobalConfig from "@config/GlobalConfig";
import EventListener from "@events/EventListener";
import AutomatedScanner from "@cf/AutomatedScanner";
import HeuristicScanner from "@cf/HeuristicScanner";
import ReportMessageCtx from "@root/commands/ReportMessageCtx";

export default class Ready extends EventListener {
	constructor() {
		super(Events.ClientReady);
	}

	execute(): Promise<unknown> {
		Logger.success(`Logged in as ${this.client.user?.tag}!`);

		// Listen for rate limit events.
		this.client.rest.on(RESTEvents.RateLimited, info => {
			Logger.warn(`DJS rate limit occurred. Data:`, info);
		});

		return Promise.all([
			AutomatedScanner.startTickLoop(),
			HeuristicScanner.startCleanupInterval(),
			GlobalConfig.startMessageReportDisregardCronJob(),
			GlobalConfig.startMessageRetentionCronJobs(),
			ReportMessageCtx.startKVCleanupJob()
		]);
	}
}
