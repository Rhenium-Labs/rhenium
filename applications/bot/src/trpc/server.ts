import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";

import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";

import { appRouter } from "./router.js";
import type { TRPCContext } from "@repo/trpc";

import Logger from "#utils/Logger.js";

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
function createContext(req: FastifyRequest): TRPCContext {
	const authHeader = req.headers["authorization"];

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
	const guildId = req.headers["x-guild-id"];
	const userId = req.headers["x-user-id"];

	return {
		guildId: (Array.isArray(guildId) ? guildId[0] : guildId) ?? null,
		userId: (Array.isArray(userId) ? userId[0] : userId) ?? null
	};
}

/**
 * Starts the tRPC HTTP server using Fastify.
 * This runs alongside the Discord gateway in the bot process.
 */
export async function startTRPCServer(): Promise<void> {
	if (!TRPC_SECRET) {
		Logger.warn("TRPC_SECRET is not set — tRPC server will not start.");
		return;
	}

	const server = Fastify();

	await server.register(cors, {
		origin: process.env.DASHBOARD_ORIGIN || "http://localhost:5173",
		methods: ["GET", "POST", "OPTIONS"],
		allowedHeaders: ["authorization", "content-type", "x-guild-id", "x-user-id"],
		maxAge: 86400
	});

	await server.register(fastifyTRPCPlugin, {
		prefix: "/trpc",
		trpcOptions: {
			router: appRouter,
			createContext: ({ req }) => createContext(req),
			onError: ({ path, error }) => {
				Logger.error(`tRPC error on '${path}':`, error.message);
			}
		} satisfies FastifyTRPCPluginOptions<typeof appRouter>["trpcOptions"]
	});

	await server.listen({ port: 3000, host: "0.0.0.0" });
	Logger.info(`tRPC server listening on port 3000.`);
}
