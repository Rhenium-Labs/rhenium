import { Events, type Guild } from "discord.js";

import EventListener from "#classes/EventListener.js";

export default class GuildCreate extends EventListener {
	public constructor() {
		super(Events.GuildCreate);
	}

	public async onEmit(guild: Guild) {
		return this.prisma.guild.upsert({
			where: { id: guild.id },
			create: { id: guild.id },
			update: {}
		});
	}
}
