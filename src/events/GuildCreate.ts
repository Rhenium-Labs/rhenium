import { Events, type Guild } from "discord.js";
import { ApplyOptions, EventListener } from "#rhenium";

import ConfigManager from "#managers/config/ConfigManager.js";

@ApplyOptions<EventListener.Options>({
	event: Events.GuildCreate
})
export default class GuildCreate extends EventListener {
	public async onEmit(guild: Guild) {
		// Compute and cache the guild configuration.
		await ConfigManager.compute(guild.id);
	}
}
