import {
	createContext,
	useContext,
	type ReactNode,
} from "react";
import { useParams } from "react-router";
import { GuildService } from "@/service/guild";

interface GuildFeatureStatus {
	enabled: boolean;
}

interface GuildData {
	id: string;
	features: {
		message_reports: GuildFeatureStatus;
		ban_requests: GuildFeatureStatus;
		content_filter: GuildFeatureStatus;
		highlights: GuildFeatureStatus;
		quick_mutes: GuildFeatureStatus;
		quick_purges: GuildFeatureStatus;
	};
}

interface GuildContextValue {
	guildId: string;
	guild: GuildData | undefined;
	isLoading: boolean;
	error: string | undefined;
	refetch: () => void;
}

const GuildContext = createContext<GuildContextValue | null>(null);

export function GuildProvider({ children }: { children: ReactNode }) {
	const { guildId } = useParams<{ guildId: string }>();

	const { data, isLoading, error, refetch } = GuildService.useGet(guildId!);

	return (
		<GuildContext.Provider
			value={{
				guildId: guildId!,
				guild: data,
				isLoading,
				error,
				refetch,
			}}
		>
			{children}
		</GuildContext.Provider>
	);
}

export function useGuild() {
	const ctx = useContext(GuildContext);
	if (!ctx) {
		throw new Error("useGuild must be used within GuildProvider");
	}
	return ctx;
}
