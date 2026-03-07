import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useGuildConfigStore } from "@/stores/guild-config";

function useConfig(guildId: string) {
	const config = useGuildConfigStore((s) => s.getConfig(guildId)?.quick_purges);

	return {
		data: config,
		isLoading: !config,
		error: undefined as string | undefined,
	};
}

function useUpdateConfig(guildId: string) {
	const setConfig = useGuildConfigStore((s) => s.setConfig);

	const mutation = trpc.quickPurges.updateConfig.useMutation({
		onSuccess(data) {
			const current = useGuildConfigStore.getState().getConfig(guildId);
			if (current) setConfig(guildId, { ...current, quick_purges: data });
		},
	});

	return {
		mutate: mutation.mutate,
		mutateAsync: mutation.mutateAsync,
		isPending: mutation.isPending,
	};
}

function useChannelScoping(guildId: string) {
	const query = trpc.quickPurges.getChannelScoping.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[QuickPurgesService.useChannelScoping]", query.error);
	}, [query.error]);

	return {
		data: query.data,
	};
}

function useSetChannelScope(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.quickPurges.setChannelScope.useMutation({
		onSuccess() {
			utils.quickPurges.getChannelScoping.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

function useRemoveChannelScope(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.quickPurges.removeChannelScope.useMutation({
		onSuccess() {
			utils.quickPurges.getChannelScoping.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

export const QuickPurgesService = {
	useConfig,
	useUpdateConfig,
	useChannelScoping,
	useSetChannelScope,
	useRemoveChannelScope,
} as const;
