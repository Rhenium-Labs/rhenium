import { Events, type Guild } from "discord.js";

import EventListener from "#managers/events/EventListener.js";
import ConfigManager from "#managers/config/ConfigManager.js";

export default class GuildCreate extends EventListener {
	public constructor() {
		super(Events.GuildCreate);
	}

	public async onEmit(guild: Guild) {
		// Compute and cache the guild configuration.
		await ConfigManager.compute(guild.id);
	}
}
