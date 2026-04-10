import { z } from "zod";
import { router, publicProcedure, authedProcedure } from "./trpc.js";

/**
 * The main application router.
 * This defines the contract between the bot and dashboard.
 *
 * The bot provides the actual implementation via `createAppRouter()`,
 * but this file defines the shape so the dashboard can import the type.
 */

/** Input schema for guild-scoped queries. */
const guildInput = z.object({
	guildId: z.string()
});

/** Simplified channel representation sent to the dashboard. */
export interface ChannelInfo {
	id: string;
	name: string;
	type: number;
	parentId: string | null;
	position: number;
}

/** Simplified role representation sent to the dashboard. */
export interface RoleInfo {
	id: string;
	name: string;
	color: number;
	position: number;
	managed: boolean;
}

/**
 * Creates the app router with the provided guild data resolvers.
 * This factory pattern lets the bot inject its Discord client at runtime.
 */
export function createAppRouter(resolvers: {
	getChannels: (guildId: string) => Promise<ChannelInfo[]>;
	getRoles: (guildId: string) => Promise<RoleInfo[]>;
	verifyMember: (guildId: string, userId: string) => Promise<boolean>;
	isDeveloper: (userId: string) => Promise<boolean>;
	invalidateConfigCache: (guildId: string) => Promise<void>;
	createWebhook: (
		guildId: string,
		channelId: string,
		existingUrl?: string
	) => Promise<{ url: string }>;
	deleteWebhook: (guildId: string, webhookUrl: string) => Promise<void>;
}) {
	return router({
		/** Health check — no auth needed. */
		health: publicProcedure.query(() => ({
			status: "ok" as const,
			timestamp: new Date()
		})),

		auth: router({
			/** Returns whether the authenticated user is a bot developer. */
			isDeveloper: authedProcedure.query(async ({ ctx }) => {
				return resolvers.isDeveloper(ctx.userId);
			})
		}),

		guild: router({
			/** Fetch all channels for a guild. */
			channels: authedProcedure.input(guildInput).query(async ({ input, ctx }) => {
				// Verify the requesting user is actually in this guild.
				const isMember = await resolvers.verifyMember(input.guildId, ctx.userId);
				if (!isMember) {
					throw new Error("You do not have access to this guild.");
				}
				return resolvers.getChannels(input.guildId);
			}),

			/** Fetch all roles for a guild. */
			roles: authedProcedure.input(guildInput).query(async ({ input, ctx }) => {
				const isMember = await resolvers.verifyMember(input.guildId, ctx.userId);
				if (!isMember) {
					throw new Error("You do not have access to this guild.");
				}
				return resolvers.getRoles(input.guildId);
			}),

			/** Force-refresh bot config cache for a guild. */
			invalidateConfigCache: authedProcedure
				.input(guildInput)
				.mutation(async ({ input, ctx }) => {
					const isMember = await resolvers.verifyMember(input.guildId, ctx.userId);
					if (!isMember) {
						throw new Error("You do not have access to this guild.");
					}

					await resolvers.invalidateConfigCache(input.guildId);
					return { success: true as const };
				}),

			/** Create or move a webhook in a guild channel. */
			createWebhook: authedProcedure
				.input(
					z.object({
						guildId: z.string(),
						channelId: z.string(),
						existingUrl: z.string().optional()
					})
				)
				.mutation(async ({ input, ctx }) => {
					const isMember = await resolvers.verifyMember(input.guildId, ctx.userId);
					if (!isMember) {
						throw new Error("You do not have access to this guild.");
					}
					return resolvers.createWebhook(
						input.guildId,
						input.channelId,
						input.existingUrl
					);
				}),

			/** Delete an existing Discord webhook by URL. */
			deleteWebhook: authedProcedure
				.input(
					z.object({
						guildId: z.string(),
						webhookUrl: z.string()
					})
				)
				.mutation(async ({ input, ctx }) => {
					const isMember = await resolvers.verifyMember(input.guildId, ctx.userId);
					if (!isMember) {
						throw new Error("You do not have access to this guild.");
					}

					await resolvers.deleteWebhook(input.guildId, input.webhookUrl);

					return { success: true as const };
				})
		})
	});
}

/** The type of the app router — used by the dashboard client. */
export type AppRouter = ReturnType<typeof createAppRouter>;
