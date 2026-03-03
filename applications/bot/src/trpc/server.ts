import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AnyRouter } from "@trpc/server";
import type { TRPCContext } from "@repo/trpc";

import Logger from "@utils/Logger";
import { appRouter } from "./router";

/** Port for the tRPC HTTP server. */
const TRPC_PORT = parseInt(process.env.TRPC_PORT || "3001", 10);

/** Shared secret for authenticating dashboard requests. */
const TRPC_SECRET = process.env.TRPC_SECRET;

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	const encoder = new TextEncoder();
	const bufA = encoder.encode(a);
	const bufB = encoder.encode(b);

	// Use crypto.subtle for timing-safe comparison.
	let result = 0;

	for (let i = 0; i < bufA.length; i++) {
		result |= bufA[i]! ^ bufB[i]!;
	}

	return result === 0;
}

/**
 * Extracts and verifies the authentication context from the request.
 * Returns null fields if auth is invalid — the authedProcedure middleware
 * will reject these requests.
 */
function createContext(req: Request): TRPCContext {
	const authHeader = req.headers.get("authorization");

	if (!TRPC_SECRET || !authHeader) {
		return { guildId: null, userId: null };
	}

	const token = authHeader.replace("Bearer ", "");

	// Verify the shared secret with constant-time comparison.
	if (!safeCompare(token, TRPC_SECRET)) {
		return { guildId: null, userId: null };
	}

	// The dashboard sends the authenticated user's guildId and userId
	// as custom headers after it has already verified the user's session
	// and guild permissions via its own auth middleware.
	const guildId = req.headers.get("x-guild-id");
	const userId = req.headers.get("x-user-id");

	return {
		guildId: guildId || null,
		userId: userId || null
	};
}

/**
 * Starts the tRPC HTTP server using Bun's native server.
 * This runs alongside the Discord gateway in the bot process.
 */
export function startTRPCServer(): void {
	if (!TRPC_SECRET) {
		Logger.warn("TRPC_SECRET is not set — tRPC server will not start.");
		return;
	}

	Bun.serve({
		port: TRPC_PORT,
		fetch: async (req: Request) => {
			const url = new URL(req.url);

			// Only handle /trpc/* paths.
			if (!url.pathname.startsWith("/trpc")) {
				return new Response("Not Found", { status: 404 });
			}

			// CORS handling for preflight requests.
			if (req.method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: {
						"Access-Control-Allow-Origin":
							process.env.DASHBOARD_ORIGIN || "http://localhost:5173",
						"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
						"Access-Control-Allow-Headers":
							"authorization, content-type, x-guild-id, x-user-id",
						"Access-Control-Max-Age": "86400"
					}
				});
			}

			const response = await fetchRequestHandler({
				endpoint: "/trpc",
				req,
				router: appRouter as AnyRouter,
				createContext: () => createContext(req),
				onError: ({ error, path }: { error: { message: string }; path?: string }) => {
					Logger.error(`tRPC error on '${path}':`, error.message);
				}
			});

			// Attach CORS headers to the response.
			response.headers.set(
				"Access-Control-Allow-Origin",
				process.env.DASHBOARD_ORIGIN || "http://localhost:5173"
			);

			return response;
		}
	});

	Logger.info(`tRPC server listening on port ${TRPC_PORT}.`);
}
