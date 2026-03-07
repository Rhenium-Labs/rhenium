import { create } from "zustand";
import { DISCORD_CACHE_TTL } from "@/constants";

export interface CachedChannel {
	id: string;
	name: string;
	type: number;
	parent_id: string | null;
	position: number;
}

export interface CachedRole {
	id: string;
	name: string;
	color: number;
	position: number;
}

interface CacheEntry<T> {
	data: T[];
	fetchedAt: number;
}

interface DiscordCacheState {
	channels: Record<string, CacheEntry<CachedChannel>>;
	roles: Record<string, CacheEntry<CachedRole>>;
	setChannels: (guildId: string, data: CachedChannel[]) => void;
	setRoles: (guildId: string, data: CachedRole[]) => void;
	getChannels: (guildId: string) => CacheEntry<CachedChannel> | undefined;
	getRoles: (guildId: string) => CacheEntry<CachedRole> | undefined;
	isStale: (guildId: string, type: "channels" | "roles") => boolean;
}

export const useDiscordCacheStore = create<DiscordCacheState>()((set, get) => ({
	channels: {},
	roles: {},

	setChannels: (guildId, data) =>
		set((s) => ({
			channels: { ...s.channels, [guildId]: { data, fetchedAt: Date.now() } },
		})),

	setRoles: (guildId, data) =>
		set((s) => ({
			roles: { ...s.roles, [guildId]: { data, fetchedAt: Date.now() } },
		})),

	getChannels: (guildId) => get().channels[guildId],
	getRoles: (guildId) => get().roles[guildId],

	isStale: (guildId, type) => {
		const entry = type === "channels" ? get().channels[guildId] : get().roles[guildId];
		if (!entry) return true;
		return Date.now() - entry.fetchedAt > DISCORD_CACHE_TTL;
	},
}));
