import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useGuildConfigStore } from "@/stores/guild-config";

function useConfig(guildId: string) {
	const config = useGuildConfigStore((s) => s.getConfig(guildId)?.content_filter);

	return {
		data: config,
		isLoading: !config,
		error: undefined as string | undefined,
	};
}

function useUpdateConfig(guildId: string) {
	const setConfig = useGuildConfigStore((s) => s.setConfig);

	const mutation = trpc.contentFilter.updateConfig.useMutation({
		onSuccess(data) {
			const current = useGuildConfigStore.getState().getConfig(guildId);
			if (current) setConfig(guildId, { ...current, content_filter: data });
		},
	});

	return {
		mutate: mutation.mutate,
		mutateAsync: mutation.mutateAsync,
		isPending: mutation.isPending,
	};
}

function useChannelScoping(guildId: string) {
	const query = trpc.contentFilter.getChannelScoping.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[ContentFilterService.useChannelScoping]", query.error);
	}, [query.error]);

	return {
		data: query.data,
	};
}

function useSetChannelScope(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.contentFilter.setChannelScope.useMutation({
		onSuccess() {
			utils.contentFilter.getChannelScoping.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

function useRemoveChannelScope(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.contentFilter.removeChannelScope.useMutation({
		onSuccess() {
			utils.contentFilter.getChannelScoping.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

export const ContentFilterService = {
	useConfig,
	useUpdateConfig,
	useChannelScoping,
	useSetChannelScope,
	useRemoveChannelScope,
} as const;
