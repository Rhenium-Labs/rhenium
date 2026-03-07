import { trpc } from "@/lib/trpc";
import { useGuildConfigStore } from "@/stores/guild-config";

function useConfig(guildId: string) {
	const config = useGuildConfigStore((s) => s.getConfig(guildId)?.message_reports);

	return {
		data: config,
		isLoading: !config,
		error: undefined as string | undefined,
	};
}

function useUpdateConfig(guildId: string) {
	const setConfig = useGuildConfigStore((s) => s.setConfig);

	const mutation = trpc.messageReports.updateConfig.useMutation({
		onSuccess(data) {
			const current = useGuildConfigStore.getState().getConfig(guildId);
			if (current) setConfig(guildId, { ...current, message_reports: data });
		},
	});

	return {
		mutate: mutation.mutate,
		mutateAsync: mutation.mutateAsync,
		isPending: mutation.isPending,
	};
}

export const MessageReportsService = {
	useConfig,
	useUpdateConfig,
} as const;
