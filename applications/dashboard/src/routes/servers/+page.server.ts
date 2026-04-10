import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

import { kysely } from "$utils/server/DB";
import { getBotInviteUrl } from "$lib/env";

import { isDeveloperUser } from "$utils/server/Authz";
import DiscordUtils from "$utils/server/Discord";
import SessionManager from "$utils/server/Session";

export interface ServerInfo {
	id: string;
	name: string;
	icon: string;
	hasBot: boolean;
	developerOnly?: boolean;
	inviteUrl?: string;
}

async function loadServers(
	token: string,
	userId: string,
	isDeveloper: boolean
): Promise<ServerInfo[]> {
	const userGuilds = await DiscordUtils.getUserGuilds({
		token,
		userId
	});

	// Get list of guild IDs where the bot is present
	const botGuilds = await kysely.selectFrom("Guild").select("id").execute();
	const botGuildIds = new Set(botGuilds.map(g => g.id));

	const serversById = new Map<string, ServerInfo>();

	for (const guild of userGuilds) {
		const hasBot = botGuildIds.has(guild.id);

		serversById.set(guild.id, {
			id: guild.id,
			name: guild.name,
			icon: DiscordUtils.generateGuildIconURL(guild.id, guild.icon, 96),
			hasBot,
			inviteUrl: !hasBot ? getBotInviteUrl(guild.id) : undefined
		});
	}

	if (isDeveloper) {
		for (const guildId of botGuildIds) {
			if (serversById.has(guildId)) continue;

			serversById.set(guildId, {
				id: guildId,
				name: `Server ${guildId}`,
				icon: "",
				hasBot: true,
				developerOnly: true
			});
		}
	}

	return [...serversById.values()]
		.map(guild => {
			const hasBot = botGuildIds.has(guild.id);

			return {
				...guild,
				hasBot,
				inviteUrl: !hasBot ? getBotInviteUrl(guild.id) : undefined
			};
		})
		.sort((a, b) => {
			if (a.hasBot !== b.hasBot) return a.hasBot ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.session) redirect(302, "/");

	const { session } = locals;
	const isDeveloper = await isDeveloperUser(session.userId);

	const accessToken = await SessionManager.getAccessToken(session.userId);

	if (!accessToken)
		// Session exists but token is invalid/expired - force re-login.
		redirect(302, "/api/auth/logout");

	return {
		session: {
			userId: session.userId,
			username: session.username,
			globalName: session.globalName,
			avatarUrl: DiscordUtils.generateAvatarURL(session.userId, session.avatar)
		},

		// Stream guilds instead of awaiting the promise.
		servers: loadServers(accessToken, session.userId, isDeveloper),
		isDeveloper
	};
};
