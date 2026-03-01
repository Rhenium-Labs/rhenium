import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useConfig(guildId: string) {
	const query = trpc.contentFilter.getConfig.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[ContentFilterService.useConfig]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
	};
}

function useUpdateConfig(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.contentFilter.updateConfig.useMutation({
		onSuccess() {
			utils.contentFilter.getConfig.invalidate({ guildId });
		},
	});

	useEffect(() => {
		if (mutation.error) console.error("[ContentFilterService.useUpdateConfig]", mutation.error);
	}, [mutation.error]);

	return {
		mutate: mutation.mutate,
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
