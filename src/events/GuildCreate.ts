import { Events, type Guild } from "discord.js";
import { ApplyOptions, EventListener } from "#rhenium";

import ConfigManager from "#root/lib/config/ConfigManager.js";

@ApplyOptions<EventListener.Options>({
	event: Events.GuildCreate
})
export default class GuildCreate extends EventListener {
	public async onEmit(guild: Guild) {
		// Trigger the creation/loading of the guild config.
		return ConfigManager.get(guild.id);
	}
}
