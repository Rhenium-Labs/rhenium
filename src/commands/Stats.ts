import { EmbedBuilder } from "discord.js";

import ms from "ms";

import { MessageQueue } from "#utils/Messages.js";
import { ApplyOptions, Command } from "#rhenium";
import type { MessageReplyData } from "#utils/Types.js";

import GlobalConfig from "#managers/config/GlobalConfig.js";

@ApplyOptions<Command.Options>({
	name: "stats",
	aliases: ["proc", "process"],
	description: "Get information about the current process."
})
export default class Stats extends Command {
	public async messageRun(message: Command.Message): Promise<MessageReplyData | null> {
		if (!GlobalConfig.isDeveloper(message.author.id)) {
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
		const members = guilds.cache.reduce((acc, guild) => acc + guild.members.cache.size, 0);

		// Database Size.
		const dbSizeQuery = await this.prisma.$queryRaw<DatabaseSizeResult[]>`
                SELECT pg_database_size(current_database()) / (1024 * 1024) as size_in_mb
                FROM pg_database
                WHERE datname = current_database()
                LIMIT 1
            `;
		const dbSize = dbSizeQuery[0].size_in_mb;

		// Message Count.
		const messageCount = await this.prisma.message.count();

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
					name: "Cached Entities",
					value: `${users.cache.size} Users / ${guilds.cache.size} Guilds / ${channels.cache.size} Channels / ${members} Members / ${MessageQueue.size} Messages`,
					inline: true
				},
				{
					name: "Database Summary",
					value: `${dbSize} MB / ${messageCount} Messages`,
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
