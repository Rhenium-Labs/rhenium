import { ChannelType, TextChannel, NewsChannel } from "discord.js";
import { createAppRouter, type ChannelInfo, type RoleInfo } from "@repo/trpc/router";

import { client } from "@root/index";
import ConfigManager from "@config/ConfigManager";

/**
 * The app router instance with Discord.js resolvers.
 * Fetches channels/roles from the bot's gateway cache for performance,
 * falling back to REST API calls when the cache is cold.
 */
export const appRouter = createAppRouter({
	async getChannels(guildId: string): Promise<ChannelInfo[]> {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) return [];

		// Channels are always cached when the bot connects to the gateway.
		// If the cache is empty, it means there aren't any channels to begin with.
		if (guild.channels.cache.size === 0) return [];

		return Array.from(guild.channels.cache.values())
			.filter((ch): ch is NonNullable<typeof ch> => ch !== null)
			.filter(ch =>
				// Only return channels useful for configuration.
				[
					ChannelType.GuildText,
					ChannelType.GuildAnnouncement,
					ChannelType.GuildForum,
					ChannelType.GuildMedia,
					ChannelType.GuildVoice,
					ChannelType.GuildStageVoice,
					ChannelType.GuildCategory
				].includes(ch.type)
			)
			.map(ch => ({
				id: ch.id,
				name: ch.name,
				type: ch.type,
				parentId: ch.parentId,
				position: "position" in ch ? (ch.position as number) : 0
			}))
			.sort((a, b) => a.position - b.position);
	},

	async getRoles(guildId: string): Promise<RoleInfo[]> {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) return [];

		const roles = guild.roles.cache.size > 0 ? guild.roles.cache : await guild.roles.fetch();

		return Array.from(roles.values())
			.filter(role => role.id !== guildId) // Exclude @everyone.
			.map(role => ({
				id: role.id,
				name: role.name,
				color: role.colors.primaryColor,
				position: role.position,
				managed: role.managed
			}))
			.sort((a, b) => b.position - a.position);
	},

	async verifyMember(guildId: string, userId: string): Promise<boolean> {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) return false;

		// Fetch will always check the cache first.
		const member = await guild.members.fetch(userId).catch(() => null);
		return member !== null;
	},

	async invalidateConfigCache(guildId: string): Promise<void> {
		await ConfigManager.reload(guildId);
	},

	async createWebhook(
		guildId: string,
		channelId: string,
		existingUrl?: string
	): Promise<{ url: string }> {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) throw new Error("Guild not found.");

		// If there's an existing webhook, try to move it.
		if (existingUrl) {
			try {
				const webhooks = await guild.fetchWebhooks();
				const existing = webhooks.find(wh => wh.url === existingUrl);
				if (existing) {
					if (existing.channelId === channelId) {
						return { url: existing.url };
					}
					const moved = await existing.edit({
						channel: channelId,
						avatar: client.user!.displayAvatarURL(),
						name: client.user!.username
					});
					return { url: moved.url };
				}
			} catch {
				// Fall through to create a new webhook.
			}
		}

		// Create a new webhook in the target channel.
		const channel = await guild.channels.fetch(channelId).catch(() => null);
		if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
			throw new Error("Channel must be a text or announcement channel.");
		}

		const webhook = await channel.createWebhook({
			name: client.user!.username ?? "Rhenium",
			avatar: client.user!.displayAvatarURL()
		});

		return { url: webhook.url };
	}
});

export type { AppRouter } from "@repo/trpc/router";
