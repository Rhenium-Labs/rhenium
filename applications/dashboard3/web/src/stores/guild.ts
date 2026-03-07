import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface GuildInfo {
	id: string;
	name: string;
	icon: string | null;
}

interface GuildState {
	selectedGuild: GuildInfo | null;
	setGuild: (guild: GuildInfo) => void;
	clearGuild: () => void;
}

export const useGuildStore = create<GuildState>()(
	persist(
		(set) => ({
			selectedGuild: null,
			setGuild: (guild) => set({ selectedGuild: guild }),
			clearGuild: () => set({ selectedGuild: null }),
		}),
		{
			name: "rhenium-guild",
			partialize: (s) => ({ selectedGuild: s.selectedGuild }),
		},
	),
);
