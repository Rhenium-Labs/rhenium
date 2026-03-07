/** Discord CDN base URL for avatars and other assets. */
export const DISCORD_CDN = "https://cdn.discordapp.com";

export function discordAvatarUrl(userId: string, hash: string | null): string | null {
	if (!hash) return null;
	return `${DISCORD_CDN}/avatars/${userId}/${hash}.webp`;
}

export function discordGuildIconUrl(guildId: string, hash: string | null): string | null {
	if (!hash) return null;
	return `${DISCORD_CDN}/icons/${guildId}/${hash}.webp`;
}

export const DISCORD_PERMISSIONS = {
	ADMINISTRATOR: 0x8,
	MANAGE_GUILD: 0x20,
} as const;
