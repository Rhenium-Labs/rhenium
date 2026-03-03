import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import {
	fetchUserGuilds,
	canManageGuild,
	getAvatarUrl,
	getGuildIconUrl
} from "$lib/server/Discord";
import { kysely } from "$lib/server/Kysely";
import { getBotInviteUrl } from "$lib/env";
import { getAccessToken } from "$lib/server/Session";

export interface ServerInfo {
	id: string;
	name: string;
	icon: string;
	hasBot: boolean;
	inviteUrl?: string;
}

async function loadServers(accessToken: string, userId: string): Promise<ServerInfo[]> {
	// Fetch user's guilds from Discord (cached for 5 minutes)
	const userGuilds = await fetchUserGuilds(accessToken, userId);

	// Get list of guild IDs where the bot is present
	const botGuilds = await kysely.selectFrom("Guild").select("id").execute();
	const botGuildIds = new Set(botGuilds.map(g => g.id));

	// Only include servers where user has management permission
	return (
		userGuilds
			.filter(guild => canManageGuild(guild))
			.map(guild => {
				const hasBot = botGuildIds.has(guild.id);

				return {
					id: guild.id,
					name: guild.name,
					icon: getGuildIconUrl(guild.id, guild.icon, 96),
					hasBot,
					inviteUrl: !hasBot ? getBotInviteUrl(guild.id) : undefined
				};
			})
			// Sort: servers with bot first, then alphabetically
			.sort((a, b) => {
				if (a.hasBot !== b.hasBot) return a.hasBot ? -1 : 1;
				return a.name.localeCompare(b.name);
			})
	);
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.session) {
		redirect(302, "/");
	}

	const { session } = locals;

	// Get the access token securely (never exposed to client)
	const accessToken = await getAccessToken(session.userId);
	if (!accessToken) {
		// Session exists but token is invalid/expired - force re-login
		redirect(302, "/api/auth/logout");
	}

	return {
		session: {
			userId: session.userId,
			username: session.username,
			globalName: session.globalName,
			avatarUrl: getAvatarUrl(session.userId, session.avatar)
		},
		// Stream servers data - page renders immediately, servers load async
		servers: loadServers(accessToken, session.userId)
	};
};
