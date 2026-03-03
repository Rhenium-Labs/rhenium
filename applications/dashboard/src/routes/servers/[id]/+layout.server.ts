import { error, redirect } from "@sveltejs/kit";
import type { RawGuildConfig } from "@repo/config";
import type { LayoutServerLoad } from "./$types";
import {
	fetchUserGuilds,
	canManageGuild,
	getAvatarUrl,
	getGuildIconUrl
} from "$lib/server/Discord";
import { kysely } from "$lib/server/Kysely";
import { getAccessToken } from "$lib/server/Session";

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.session) {
		redirect(302, "/");
	}

	const { session } = locals;
	const guildId = params.id;

	// Get the access token securely (never exposed to client)
	const accessToken = await getAccessToken(session.userId);
	if (!accessToken) {
		// Session exists but token is invalid/expired - force re-login
		redirect(302, "/api/auth/logout");
	}

	try {
		// Verify the bot is in this guild
		const guild = (await kysely
			.selectFrom("Guild")
			.select(["id", "config"])
			.where("id", "=", guildId)
			.executeTakeFirst()) as { id: string; config: RawGuildConfig } | undefined;

		if (!guild) {
			error(404, {
				message: "Server not found",
				description:
					"The bot is not installed in this server, or the server doesn't exist."
			});
		}

		// Verify user has access to this guild (cached for 5 minutes)
		const userGuilds = await fetchUserGuilds(accessToken, session.userId);
		const userGuild = userGuilds.find(g => g.id === guildId);

		if (!userGuild) {
			error(403, {
				message: "Access denied",
				description: "You are not a member of this server."
			});
		}

		if (!canManageGuild(userGuild)) {
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
				avatarUrl: getAvatarUrl(session.userId, session.avatar)
			},
			guild: {
				id: userGuild.id,
				name: userGuild.name,
				icon: getGuildIconUrl(userGuild.id, userGuild.icon, 256),
				config: guild.config
			}
		};
	} catch (err) {
		if (err && typeof err === "object" && "status" in err) {
			throw err;
		}

		console.error("Failed to load server:", err);
		redirect(302, "/api/auth/logout");
	}
};
