import { json } from "@sveltejs/kit";
import type { RawGuildConfig } from "@repo/config";

import BotApi from "$utils/server/BotApi";
import { isDeveloperUser } from "$utils/server/Authz";
import { kysely } from "$utils/server/DB";
import DiscordUtils from "$utils/server/Discord";
import SessionManager from "$utils/server/Session";

type AccessContext = {
	locals: App.Locals;
};

type ConfigAccessResult =
	| {
			ok: true;
			session: NonNullable<App.Locals["session"]>;
			currentConfig: RawGuildConfig;
	  }
	| {
			ok: false;
			response: ReturnType<typeof json>;
	  };

export const DISCORD_ID_REGEX = /^\d{17,20}$/;

/**
 * Dashboard config API helpers.
 */
export default class ConfigApi {
	/**
	 * Validates that a JSON request came from the dashboard origin.
	 *
	 * @param request Incoming request.
	 * @param expectedOrigin Dashboard origin.
	 * @returns An error message when unsafe, otherwise null.
	 */
	static ensureSafeJsonRequest(request: Request, expectedOrigin: string): string | null {
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

	/**
	 * Safely parses a JSON string.
	 *
	 * @param raw Raw JSON string.
	 * @returns Parsed data or a failed result.
	 */
	static parseJsonSafely<T = unknown>(
		raw: string
	): { ok: true; data: T } | { ok: false } {
		try {
			return { ok: true, data: JSON.parse(raw) as T };
		} catch {
			return { ok: false };
		}
	}

	/**
	 * Checks whether content filtering is enabled for a guild.
	 *
	 * @param guildId Discord guild ID.
	 * @returns True when content filtering is available.
	 */
	static async isGuildContentFilterWhitelisted(guildId: string): Promise<boolean> {
		const whitelistEntry = await kysely
			.selectFrom("Whitelist")
			.select(["id"])
			.where("id", "=", guildId)
			.executeTakeFirst();

		return whitelistEntry !== undefined;
	}

	/**
	 * Requires the current session to have dashboard config access for a guild.
	 *
	 * @param context SvelteKit locals wrapper.
	 * @param guildId Discord guild ID.
	 * @returns Access context or a ready HTTP response.
	 */
	static async requireGuildConfigAccess(
		context: AccessContext,
		guildId: string
	): Promise<ConfigAccessResult> {
		if (!context.locals.session) {
			return this._error("Not authenticated.", 401);
		}

		if (!DISCORD_ID_REGEX.test(guildId)) {
			return this._error("Invalid guild id.", 400);
		}

		const accessToken = await SessionManager.getAccessToken(context.locals.session.userId);

		if (!accessToken) {
			return this._error("Session expired.", 401);
		}

		const userGuilds = await DiscordUtils.getUserGuilds({
			token: accessToken,
			userId: context.locals.session.userId
		});

		const userGuild = userGuilds.find(guild => guild.id === guildId);
		const isDeveloper = await isDeveloperUser(context.locals.session.userId);

		if (!userGuild && !isDeveloper) {
			return this._error("Access denied.", 403);
		}

		if (!isDeveloper && userGuild && !DiscordUtils.canManage(userGuild)) {
			return this._error("Insufficient permissions.", 403);
		}

		const guild = (await kysely
			.selectFrom("Guild")
			.select(["config"])
			.where("id", "=", guildId)
			.executeTakeFirst()) as { config: RawGuildConfig } | undefined;

		if (!guild) {
			return this._error("Server not found.", 404);
		}

		return {
			ok: true,
			session: context.locals.session,
			currentConfig: guild.config
		};
	}

	/**
	 * Requires config access and content-filter whitelist status.
	 *
	 * @param context SvelteKit locals wrapper.
	 * @param guildId Discord guild ID.
	 * @returns Access context or a ready HTTP response.
	 */
	static async requireContentFilterConfigAccess(
		context: AccessContext,
		guildId: string
	): Promise<ConfigAccessResult> {
		const access = await this.requireGuildConfigAccess(context, guildId);
		if (!access.ok) return access;

		const whitelisted = await this.isGuildContentFilterWhitelisted(guildId);
		if (!whitelisted) {
			return this._error("Content filter is unavailable for this server.", 403);
		}

		return access;
	}

	/**
	 * Invalidates the Rust bot's cached guild configuration.
	 *
	 * @param guildId Discord guild ID.
	 * @param userId Discord user ID.
	 */
	static async invalidateBotConfigCache(guildId: string, userId: string): Promise<void> {
		await BotApi.invalidateConfigCache({ guildId, userId });
	}

	private static _error(message: string, status: number): ConfigAccessResult {
		return {
			ok: false,
			response: json({ success: false, error: message }, { status })
		};
	}
}

export const ensureSafeJsonRequest = ConfigApi.ensureSafeJsonRequest.bind(ConfigApi);
export const parseJsonSafely = ConfigApi.parseJsonSafely.bind(ConfigApi);
export const isGuildContentFilterWhitelisted =
	ConfigApi.isGuildContentFilterWhitelisted.bind(ConfigApi);
export const requireGuildConfigAccess = ConfigApi.requireGuildConfigAccess.bind(ConfigApi);
export const requireContentFilterConfigAccess =
	ConfigApi.requireContentFilterConfigAccess.bind(ConfigApi);
export const invalidateBotConfigCache = ConfigApi.invalidateBotConfigCache.bind(ConfigApi);
