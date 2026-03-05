import { json } from "@sveltejs/kit";
import type { RawGuildConfig } from "@repo/config";

import { kysely } from "$utils/server/DB";
import { createBotClient } from "$utils/server/TRPC";

import DiscordUtils from "$utils/server/Discord";
import SessionManager from "$utils/server/Session";

export const DISCORD_ID_REGEX = /^\d{17,20}$/;

export function ensureSafeJsonRequest(request: Request, expectedOrigin: string): string | null {
	const secFetchSite = request.headers.get("sec-fetch-site");
	if (secFetchSite === "cross-site") return "Cross-site requests are not allowed.";

	const origin = request.headers.get("origin");
	if (origin && origin !== expectedOrigin) return "Invalid origin.";

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().startsWith("application/json")) {
		return "Content-Type must be application/json.";
	}

	return null;
}

export function parseJsonSafely<T = unknown>(raw: string): { ok: true; data: T } | { ok: false } {
	try {
		return { ok: true, data: JSON.parse(raw) as T };
	} catch {
		return { ok: false };
	}
}

type AccessContext = {
	locals: App.Locals;
};

export async function requireGuildConfigAccess(context: AccessContext, guildId: string) {
	if (!context.locals.session) {
		return {
			ok: false as const,
			response: json({ success: false, error: "Not authenticated." }, { status: 401 })
		};
	}

	if (!DISCORD_ID_REGEX.test(guildId)) {
		return {
			ok: false as const,
			response: json({ success: false, error: "Invalid guild id." }, { status: 400 })
		};
	}

	const accessToken = await SessionManager.getAccessToken(context.locals.session.userId);

	if (!accessToken) {
		return {
			ok: false as const,
			response: json({ success: false, error: "Session expired." }, { status: 401 })
		};
	}

	const userGuilds = await DiscordUtils.getUserGuilds({
		token: accessToken,
		userId: context.locals.session.userId
	});

	const userGuild = userGuilds.find(g => g.id === guildId);

	if (!userGuild) {
		return {
			ok: false as const,
			response: json({ success: false, error: "Access denied." }, { status: 403 })
		};
	}

	if (!DiscordUtils.canManage(userGuild)) {
		return {
			ok: false as const,
			response: json(
				{ success: false, error: "Insufficient permissions." },
				{ status: 403 }
			)
		};
	}

	const guild = (await kysely
		.selectFrom("Guild")
		.select(["config"])
		.where("id", "=", guildId)
		.executeTakeFirst()) as { config: RawGuildConfig } | undefined;

	if (!guild) {
		return {
			ok: false as const,
			response: json({ success: false, error: "Server not found." }, { status: 404 })
		};
	}

	return {
		ok: true as const,
		session: context.locals.session,
		currentConfig: guild.config
	};
}

export async function invalidateBotConfigCache(guildId: string, userId: string): Promise<void> {
	const trpc = createBotClient(guildId, userId);
	await trpc.guild.invalidateConfigCache.mutate({ guildId });
}
