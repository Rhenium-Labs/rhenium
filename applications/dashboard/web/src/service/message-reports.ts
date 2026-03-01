import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useConfig(guildId: string) {
	const query = trpc.messageReports.getConfig.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[MessageReportsService.useConfig]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
	};
}

function useUpdateConfig(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.messageReports.updateConfig.useMutation({
		onSuccess() {
			utils.messageReports.getConfig.invalidate({ guildId });
		},
	});

	useEffect(() => {
		if (mutation.error) console.error("[MessageReportsService.useUpdateConfig]", mutation.error);
	}, [mutation.error]);

	return {
		mutate: mutation.mutate,
		isPending: mutation.isPending,
	};
}

export const MessageReportsService = {
	useConfig,
	useUpdateConfig,
} as const;
