import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

/**
 * Context provided to every tRPC procedure.
 * The bot populates this with the actual Discord client + verified auth.
 */
export interface TRPCContext {
	/** The verified guild ID from the authenticated request. */
	guildId: string | null;

	/** The verified user ID from the authenticated request. */
	userId: string | null;
}

/** Initialize tRPC with superjson for rich serialization (Dates, Maps, etc). */
const t = initTRPC.context<TRPCContext>().create({
	transformer: superjson
});

/** Base router factory. */
export const router = t.router;

/** Public procedure — no auth required (health check, etc). */
export const publicProcedure = t.procedure;

/**
 * Authenticated procedure — requires valid guildId + userId in context.
 * The bot's HTTP handler is responsible for verifying the shared secret
 * and populating the context before this middleware runs.
 */
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
	if (!ctx.guildId || !ctx.userId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Missing authentication context."
		});
	}

	return next({
		ctx: {
			guildId: ctx.guildId,
			userId: ctx.userId
		}
	});
});

/** Merge sub-routers. */
export const mergeRouters = t.mergeRouters;

/** Re-export types for consumers. */
export type { TRPCError };
