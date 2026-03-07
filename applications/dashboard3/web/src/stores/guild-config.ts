import { create } from "zustand";
import type { RawGuildConfig } from "@repo/config";

interface GuildConfigState {
	/** Configs keyed by guild ID. Populated when userGuilds loads. */
	configs: Record<string, RawGuildConfig>;
	setConfigs: (configs: Record<string, RawGuildConfig>) => void;
	setConfig: (guildId: string, config: RawGuildConfig) => void;
	getConfig: (guildId: string) => RawGuildConfig | undefined;
	clearConfigs: () => void;
}

export const useGuildConfigStore = create<GuildConfigState>()((set, get) => ({
	configs: {},
	setConfigs: (configs) => set({ configs }),
	setConfig: (guildId, config) =>
		set((s) => ({ configs: { ...s.configs, [guildId]: config } })),
	getConfig: (guildId) => get().configs[guildId],
	clearConfigs: () => set({ configs: {} }),
}));
