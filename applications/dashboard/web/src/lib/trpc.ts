import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "@server/src/di/container";
import { apiUrl } from "./api";
import { useAuthStore } from "@/stores/auth";
import { useGuildConfigStore } from "@/stores/guild-config";

export const trpc = createTRPCReact<AppRouter>();

function handleUnauthorized() {
	useAuthStore.getState().logout();
	useGuildConfigStore.getState().clearConfigs();
	if (window.location.pathname !== "/") {
		window.location.href = "/";
	}
}

export function isUnauthorizedError(error: unknown): boolean {
	return error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";
}

export function createTRPCClient() {
	return trpc.createClient({
		links: [
			httpBatchLink({
				url: apiUrl("/api/v1/trpc"),
				headers: () => {
					const token = useAuthStore.getState().token;
					return token ? { Authorization: `Bearer ${token}` } : {};
				},
				async fetch(url, options) {
					const res = await fetch(url, options);
					if (res.status === 401) {
						handleUnauthorized();
					}
					return res;
				},
			}),
		],
	});
}
