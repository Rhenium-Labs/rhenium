import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useConfig(guildId: string) {
	const query = trpc.quickMutes.getConfig.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[QuickMutesService.useConfig]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
	};
}

function useUpdateConfig(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.quickMutes.updateConfig.useMutation({
		onSuccess() {
			utils.quickMutes.getConfig.invalidate({ guildId });
		},
	});

	useEffect(() => {
		if (mutation.error) console.error("[QuickMutesService.useUpdateConfig]", mutation.error);
	}, [mutation.error]);

	return {
		mutate: mutation.mutate,
		isPending: mutation.isPending,
	};
}

function useChannelScoping(guildId: string) {
	const query = trpc.quickMutes.getChannelScoping.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[QuickMutesService.useChannelScoping]", query.error);
	}, [query.error]);

	return {
		data: query.data,
	};
}

function useSetChannelScope(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.quickMutes.setChannelScope.useMutation({
		onSuccess() {
			utils.quickMutes.getChannelScoping.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

function useRemoveChannelScope(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.quickMutes.removeChannelScope.useMutation({
		onSuccess() {
			utils.quickMutes.getChannelScoping.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

export const QuickMutesService = {
	useConfig,
	useUpdateConfig,
	useChannelScoping,
	useSetChannelScope,
	useRemoveChannelScope,
} as const;
