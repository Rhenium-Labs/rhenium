import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useConfig(guildId: string) {
	const query = trpc.banRequests.getConfig.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[BanRequestsService.useConfig]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
	};
}

function useUpdateConfig(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.banRequests.updateConfig.useMutation({
		onSuccess() {
			utils.banRequests.getConfig.invalidate({ guildId });
		},
	});

	useEffect(() => {
		if (mutation.error) console.error("[BanRequestsService.useUpdateConfig]", mutation.error);
	}, [mutation.error]);

	return {
		mutate: mutation.mutate,
		isPending: mutation.isPending,
	};
}

export const BanRequestsService = {
	useConfig,
	useUpdateConfig,
} as const;
