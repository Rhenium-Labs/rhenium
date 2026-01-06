import { EmbedBuilder, type Message } from "discord.js";

import ms from "ms";

import { DEVELOPER_IDS } from "#utils/Constants.js";
import type { MessageReplyData } from "#utils/Types.js";

import Command from "#managers/commands/Command.js";

export default class Stats extends Command {
	public constructor() {
		super({
			name: "stats",
			aliases: ["proc", "process"],
			description: "Get information about the current process."
		});
	}

	public async messageRun(message: Message<true>): Promise<MessageReplyData | null> {
		if (!DEVELOPER_IDS.includes(message.author.id)) {
			return null;
		}

		// Process Uptime.
		const processUptime = Math.round(Math.floor(process.uptime() * 1000));
		const processUptimeStr = ms(processUptime, { long: true });

		// Client Uptime.
		const clientUptime = Math.round(Math.floor(this.client.uptime));
		const clientUptimeStr = ms(clientUptime, { long: true });

		// Memory Usage.
		const memoryUsage = process.memoryUsage();
		const rss = (memoryUsage.rss / 1024 / 1024).toFixed(0);
		const heapUsed = (memoryUsage.heapUsed / 1024 / 1024).toFixed(0);
		const heapTotal = (memoryUsage.heapTotal / 1024 / 1024).toFixed(0);

		// Cache.
		const { guilds, users, channels } = this.client;

		// Database Size.
		const dbSizeQuery = await this.prisma.$queryRaw<DatabaseSizeResult[]>`
                SELECT pg_database_size(current_database()) / (1024 * 1024) as size_in_mb
                FROM pg_database
                WHERE datname = current_database()
                LIMIT 1
            `;

		const dbSize = dbSizeQuery[0].size_in_mb;

		const embed = new EmbedBuilder()
			.setColor("NotQuiteBlack")
			.setAuthor({ name: this.client.user.username, iconURL: this.client.user.displayAvatarURL() })
			.setFields([
				{
					name: "Heartbeat",
					value: `${this.client.ws.ping}ms`,
					inline: true
				},
				{
					name: "Client Uptime",
					value: clientUptimeStr,
					inline: true
				},
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
					name: "Cache Entries",
					value: `${users.cache.size} Users / ${guilds.cache.size} Guilds / ${channels.cache.size} Channels`,
					inline: true
				},
				{
					name: "Database Size",
					value: `${dbSize} MB`,
					inline: true
				}
			])
			.setFooter({ text: `Client ID: ${this.client.user.id}` })
			.setTimestamp();

		return { embeds: [embed] };
	}
}

interface DatabaseSizeResult {
	size_in_mb: number;
}
