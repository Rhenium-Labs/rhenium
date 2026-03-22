import { Events, type Guild } from "discord.js";
import { getWhitelistStatus } from "#utils/index.js";

import ConfigManager from "#config/ConfigManager.js";
import EventListener from "#events/EventListener.js";
import Logger from "#utils/Logger.js";

export default class GuildCreate extends EventListener {
	constructor() {
		super(Events.GuildCreate);
	}

	async execute(guild: Guild): Promise<void> {
		const whitelisted = await getWhitelistStatus(guild.id);

		if (!whitelisted) {
			Logger.warn(`Guild "${guild.name}" (${guild.id}) is not whitelisted. Leaving...`);
			return guild
				.leave()
				.then(() => Logger.info(`Left guild "${guild.name}" (${guild.id}).`))
				.catch(() => {});
		}

		// Trigger the creation/loading of the guild config.
		ConfigManager.getGuildConfig(guild.id);
	}
}
