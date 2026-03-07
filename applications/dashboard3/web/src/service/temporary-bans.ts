import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useList(guildId: string) {
	const query = trpc.temporaryBans.list.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[TemporaryBansService.useList]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
	};
}

export const TemporaryBansService = {
	useList,
} as const;
