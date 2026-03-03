import { BOT_TRPC_URL, TRPC_SECRET } from "$env/static/private";
import { createBotClient as _createBotClient } from "@repo/trpc/client";
import Logger from "$lib/server/Logger";

/**
 * Creates a per-request tRPC client scoped to a specific guild and user.
 * Call this from server load functions or form actions.
 *
 * Usage:
 * ```ts
 * const trpc = createBotClient(guildId, userId);
 * const channels = await trpc.guild.channels.query({ guildId });
 * ```
 */
export function createBotClient(guildId: string, userId: string) {
	return _createBotClient(BOT_TRPC_URL, TRPC_SECRET, { guildId, userId });
}

async function withFallback<T>(loader: () => Promise<T>, fallback: T, context: string): Promise<T> {
	try {
		return await loader();
	} catch (error) {
		Logger.warn("tRPC query failed, using fallback data", {
			context,
			error:
				error instanceof Error
					? {
							name: error.name,
							message: error.message,
							stack: error.stack
						}
					: String(error)
		});
		return fallback;
	}
}

export async function safeLoadChannels(guildId: string, userId: string) {
	const trpc = createBotClient(guildId, userId);
	return withFallback(
		() => trpc.guild.channels.query({ guildId }),
		[],
		`channels query for guild ${guildId}`
	);
}

export async function safeLoadRoles(guildId: string, userId: string) {
	const trpc = createBotClient(guildId, userId);
	return withFallback(
		() => trpc.guild.roles.query({ guildId }),
		[],
		`roles query for guild ${guildId}`
	);
}

export async function safeLoadChannelsAndRoles(guildId: string, userId: string) {
	const trpc = createBotClient(guildId, userId);
	const [channels, roles] = await Promise.all([
		withFallback(
			() => trpc.guild.channels.query({ guildId }),
			[],
			`channels query for guild ${guildId}`
		),
		withFallback(
			() => trpc.guild.roles.query({ guildId }),
			[],
			`roles query for guild ${guildId}`
		)
	]);

	return { channels, roles };
}
