import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

function useList(guildId: string) {
	const query = trpc.logging.list.useQuery({ guildId });

	useEffect(() => {
		if (query.error) console.error("[LoggingService.useList]", query.error);
	}, [query.error]);

	return {
		data: query.data,
		isLoading: query.isLoading,
		error: query.error?.message,
	};
}

function useCreate(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.logging.create.useMutation({
		onSuccess() {
			utils.logging.list.invalidate({ guildId });
		},
	});

	useEffect(() => {
		if (mutation.error) console.error("[LoggingService.useCreate]", mutation.error);
	}, [mutation.error]);

	return {
		mutate: mutation.mutate,
		isPending: mutation.isPending,
	};
}

function useUpdate(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.logging.update.useMutation({
		onSuccess() {
			utils.logging.list.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

function useDelete(guildId: string) {
	const utils = trpc.useUtils();
	const mutation = trpc.logging.delete.useMutation({
		onSuccess() {
			utils.logging.list.invalidate({ guildId });
		},
	});

	return {
		mutate: mutation.mutate,
	};
}

export const LoggingService = {
	useList,
	useCreate,
	useUpdate,
	useDelete,
} as const;
