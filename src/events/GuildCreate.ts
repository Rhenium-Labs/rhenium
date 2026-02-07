import { Events, type Guild } from "discord.js";

import ConfigManager from "#config/ConfigManager.js";
import EventListener from "#events/EventListener.js";

export default class GuildCreate extends EventListener {
	constructor() {
		super(Events.GuildCreate);
	}

	execute(guild: Guild): void {
		// Trigger the creation/loading of the guild config.
		ConfigManager.get(guild.id);
	}
}
