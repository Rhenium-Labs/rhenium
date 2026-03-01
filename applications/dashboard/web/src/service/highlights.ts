import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useConfig(guildId: string) {
	const query = trpc.highlights.getConfig.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[HighlightsService.useConfig]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
	};
}

function useUpdateConfig(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.highlights.updateConfig.useMutation({
		onSuccess() {
			utils.highlights.getConfig.invalidate({ guildId });
		},
	});

	useEffect(() => {
		if (mutation.error) console.error("[HighlightsService.useUpdateConfig]", mutation.error);
	}, [mutation.error]);

	return {
		mutate: mutation.mutate,
		isPending: mutation.isPending,
	};
}

export const HighlightsService = {
	useConfig,
	useUpdateConfig,
} as const;
