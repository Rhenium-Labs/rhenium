import { Result } from "@sapphire/result";
import { type ApplicationCommandData, Events } from "discord.js";

import { client } from "#root/index.js";
import { inflect, sleep } from "#utils/index.js";
import { ApplyOptions, EventListener } from "#rhenium";

import Logger from "#utils/Logger.js";
import GlobalConfig from "#root/lib/config/GlobalConfig.js";
import AutomatedScanner from "#cf/AutomatedScanner.js";
import HeuristicScanner from "#cf/HeuristicScanner.js";
import { up } from "#root/migration.js";

@ApplyOptions<EventListener.Options>({
	event: Events.ClientReady
})
export default class Ready extends EventListener {
	public async onEmit(): Promise<void> {
		Logger.success(`Logged in as ${this.client.user?.tag}!`);

		void Promise.all([
			Ready._register(),
			AutomatedScanner.startTickLoop(),
			HeuristicScanner.startCleanupInterval(),
			GlobalConfig.startMessageReportDisregardCronJob(),
			GlobalConfig.startMessageRetentionCronJobs()
		]);

		await sleep(3000);

		await up();
	}

	/** Registers application commands with Discord. */
	private static async _register(): Promise<void> {
		const commands: ApplicationCommandData[] = client.stores
			.get("commands")
			.filter(cmd => cmd.register !== undefined)
			.map(cmd => cmd.register!());

		if (commands.length === 0) {
			Logger.info("Found no application commands to register.");
			return;
		}

		// Short delay since client.application isn't immediately available.
		await sleep(2000);

		// prettier-ignore
		const result = await Result.fromAsync(() =>
			client.application!.commands.set(commands)
		);

		if (!result.isOk()) {
			const error = result.unwrapErr();

			Logger.error("Failed to register application commands:", error);
			process.exit(1);
		}

		Logger.success(
			`Registered ${commands.length} application ${inflect(commands.length, "command")}.`
		);
	}
}
