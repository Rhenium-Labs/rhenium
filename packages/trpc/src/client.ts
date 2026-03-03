/**
 * tRPC client utilities for the dashboard.
 * This module provides typed client creation for calling the bot's tRPC server.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";

import type { AppRouter } from "./router";

/** Per-request context for guild/user scoped calls. */
export interface ClientContext {
	guildId: string;
	userId: string;
}

/**
 * Creates a typed tRPC client for the dashboard to call the bot.
 *
 * @param botUrl The base URL of the bot's tRPC server (e.g., "http://localhost:3001").
 * @param secret The shared secret for authenticating requests from the dashboard.
 * @param context Optional per-request guild/user context for authed procedures.
 */
export function createBotClient(botUrl: string, secret: string, context?: ClientContext) {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${botUrl}/trpc`,
				transformer: superjson,
				headers: () => ({
					authorization: `Bearer ${secret}`,
					...(context && {
						"x-guild-id": context.guildId,
						"x-user-id": context.userId
					})
				})
			})
		]
	});
}

export type { AppRouter };
