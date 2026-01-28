import { Events } from "discord.js";

import { ApplyOptions, EventListener } from "#rhenium";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#root/lib/config/GlobalConfig.js";
import AutomatedScanner from "#cf/AutomatedScanner.js";
import HeuristicScanner from "#cf/HeuristicScanner.js";

@ApplyOptions<EventListener.Options>({
	event: Events.ClientReady
})
export default class Ready extends EventListener {
	public async onEmit(): Promise<any> {
		Logger.success(`Logged in as ${this.client.user?.tag}!`);

		void Promise.all([
			AutomatedScanner.startTickLoop(),
			HeuristicScanner.startCleanupInterval(),
			GlobalConfig.startMessageReportDisregardCronJob(),
			GlobalConfig.startMessageRetentionCronJobs()
		]);
	}
}
