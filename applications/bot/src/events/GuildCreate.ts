import { Events, type Guild } from "discord.js";

import ConfigManager from "#config/ConfigManager.js";
import EventListener from "#events/EventListener.js";

export default class GuildCreate extends EventListener {
	constructor() {
		super(Events.GuildCreate);
	}

	async execute(guild: Guild): Promise<void> {
		// Trigger the creation/loading of the guild config.
		ConfigManager.getGuildConfig(guild.id);
	}
}
