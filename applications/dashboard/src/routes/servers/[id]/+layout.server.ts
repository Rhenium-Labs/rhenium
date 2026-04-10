import { error, isHttpError, isRedirect, redirect } from "@sveltejs/kit";
import type { RawGuildConfig } from "@repo/config";
import type { LayoutServerLoad } from "./$types";

import { kysely } from "$utils/server/DB";

import Logger from "$utils/Logger";
import { isDeveloperUser } from "$utils/server/Authz";
import DiscordUtils from "$utils/server/Discord";
import SessionManager from "$utils/server/Session";

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.session) redirect(302, "/");

	const { session } = locals;
	const guildId = params.id;
	const isDeveloper = await isDeveloperUser(session.userId);

	// Get the access token securely (never exposed to client)
	const accessToken = await SessionManager.getAccessToken(session.userId);

	if (!accessToken)
		// Session exists but token is invalid/expired - force re-login
		redirect(302, "/api/auth/logout");

	try {
		const guild = (await kysely
			.selectFrom("Guild")
			.select(["id", "config"])
			.where("id", "=", guildId)
			.executeTakeFirst()) as { id: string; config: RawGuildConfig } | undefined;

		if (!guild)
			error(404, {
				message: "Server not found",
				description:
					"The bot is not installed in this server, or the server doesn't exist."
			});

		// Verify user has access to this guild (cached for 5 minutes).
		const userGuilds = await DiscordUtils.getUserGuilds({
			token: accessToken,
			userId: session.userId
		});

		const userGuild = userGuilds.find(g => g.id === guildId);

		if (!userGuild && !isDeveloper) {
			error(403, {
				message: "Access denied",
				description: "You are not a member of this server."
			});
		}

		if (!isDeveloper && userGuild && !DiscordUtils.canManage(userGuild)) {
			error(403, {
				message: "Insufficient permissions",
				description:
					"You need Administrator, Manage Server permission, or be the owner to access this dashboard."
			});
		}

		return {
			session: {
				userId: session.userId,
				username: session.username,
				globalName: session.globalName,
				avatarUrl: DiscordUtils.generateAvatarURL(session.userId, session.avatar)
			},
			guild: {
				id: guild.id,
				name: userGuild?.name ?? `Server ${guild.id}`,
				icon: userGuild
					? DiscordUtils.generateGuildIconURL(userGuild.id, userGuild.icon, 256)
					: "",
				config: guild.config
			}
		};
	} catch (err) {
		// Re-throw SvelteKit's own error/redirect responses
		if (isHttpError(err) || isRedirect(err)) {
			throw err;
		}

		console.error("Failed to load server:", err);
		Logger.errorWithCause("Failed to load guild layout", err, {
			guildId: params.id,
			userId: locals.session?.userId ?? null
		});

		redirect(302, "/api/auth/logout");
	}
};
