import { Events, RESTEvents } from "discord.js";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#config/GlobalConfig.js";
import EventListener from "#events/EventListener.js";
import AutomatedScanner from "#managers/cf/AutomatedScanner.js";
import HeuristicScanner from "#managers/cf/HeuristicScanner.js";
import ReportMessageCtx from "#root/commands/ReportMessageCtx.js";

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
			AutomatedScanner.loadPrioritizedGuilds(),
			HeuristicScanner.startCleanupInterval(),
			GlobalConfig.startMessageReportDisregardCronJob(),
			GlobalConfig.startMessageRetentionCronJobs(),
			ReportMessageCtx.startKVCleanupJob()
		]);
	}
}
