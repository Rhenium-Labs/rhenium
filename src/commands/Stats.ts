import { EmbedBuilder, type Message } from "discord.js";

import ms from "ms";

import { MessageQueue } from "#utils/Messages.js";
import type { MessageReplyData } from "#utils/Types.js";

import Command from "#managers/commands/Command.js";
import GlobalConfig from "#managers/config/GlobalConfig.js";

export default class Stats extends Command {
	public constructor() {
		super({
			name: "stats",
			aliases: ["proc", "process"],
			description: "Get information about the current process."
		});
	}

	public async messageRun(message: Message<true>): Promise<MessageReplyData | null> {
		if (!GlobalConfig.isDeveloper(message.author.id)) {
			return null;
		}

		// Process Uptime.
		const processUptime = Math.round(Math.floor(process.uptime() * 1000));
		const processUptimeStr = ms(processUptime, { long: true });

		// Memory Usage.
		const memoryUsage = process.memoryUsage();
		const rss = (memoryUsage.rss / 1024 / 1024).toFixed(0);
		const heapUsed = (memoryUsage.heapUsed / 1024 / 1024).toFixed(0);
		const heapTotal = (memoryUsage.heapTotal / 1024 / 1024).toFixed(0);

		// Cached Data.
		const cachedUsers = this.client.users.cache.size;
		const cachedBots = this.client.users.cache.filter(user => user.bot).size;
		const cachedGuilds = this.client.guilds.cache.size;
		const cachedChannels = this.client.channels.cache.size;
		const cachedMessages = MessageQueue.size;

		const embed = new EmbedBuilder()
			.setColor("NotQuiteBlack")
			.setAuthor({ name: this.client.user.username, iconURL: this.client.user.displayAvatarURL() })
			.setFields([
				{
					name: "Process Uptime",
					value: processUptimeStr,
					inline: true
				},
				{
					name: "Memory Usage",
					value: `${heapUsed} MB / ${heapTotal} MB / ${rss} MB`,
					inline: true
				},
				{
					name: "Cached Users",
					value: `${cachedUsers} (${cachedBots} bots)`,
					inline: true
				},
				{
					name: "Cached Guilds",
					value: `${cachedGuilds}`,
					inline: true
				},
				{
					name: "Cached Channels",
					value: `${cachedChannels}`,
					inline: true
				},
				{
					name: "Cached Messages",
					value: `${cachedMessages}`,
					inline: true
				}
			])
			.setFooter({ text: `Client ID: ${this.client.user.id}` })
			.setTimestamp();

		return { embeds: [embed] };
	}
}
