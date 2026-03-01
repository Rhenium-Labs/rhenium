import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@server/src/trpc/router";
import { apiUrl } from "./api";
import { useAuthStore } from "@/stores/auth";

export const trpc = createTRPCReact<AppRouter>();

export function createTRPCClient() {
	return trpc.createClient({
		links: [
			httpBatchLink({
				url: apiUrl("/api/v1/trpc"),
				headers: () => {
					const token = useAuthStore.getState().token;
					return token ? { Authorization: `Bearer ${token}` } : {};
				},
			}),
		],
	});
}
